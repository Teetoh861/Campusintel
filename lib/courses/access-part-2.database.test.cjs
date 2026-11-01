// A2 real waiters, using the same explicitly selected disposable stack as A1.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./access-scope-fixture.cjs')
const { claimHashes, readClaimHashKeys } = require('../entitlements/claim-hash.ts')
const course = () => f.sql(`select id from public.institutional_courses where repository_course_id='${f.COURSE}'`)
const call = (p, name, rest) => f.service(`select public.${name}('${p.session}',${rest})::text`)
const result = async statement => f.state(await f.background(statement))
async function queued(heldStatement, request, label) {
  let held, pending
  try {
    held = await f.hold(heldStatement)
    const marker = 'a2-wait-' + f.randomUUID()
    pending = f.background(`/* ${marker} */ ${request}`)
    await f.until(() => f.waiting(marker), label)
    await held.release(); held = null
    return f.state(await pending)
  } finally { if (held) await held.release(); if (pending) await pending }
}
function pass() {
  const p = f.student({ source: null })
  f.sql(`insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,ai_terms,ai_units,created_by)
    values('${p.user}','trial','discovery',now()-interval '1 day',now()+interval '1 day','capped',10,'a2-race')`)
  return p
}

test('Discovery queued behind a selection correction refuses the formerly own course', { skip: !f.enabled }, async () => {
  const p = pass()
  try {
    const out = await queued(f.correction(p),call(p,'discovery_preview',`'${f.COURSE}','cbt',true,null,300`),'Discovery waits for profile scope')
    assert.equal(out.state,'not-offered')
    assert.equal(f.sql(`select count(*) from private.discovery_previews where user_id='${p.user}'`),'0')
  } finally { f.cleanup(p) }
})

test('completed free exam remains score-only through concurrent read, save and submit replays', { skip: !f.enabled }, async () => {
  const p = pass()
  try {
    assert.equal((await result(call(p,'discovery_preview',`'${f.COURSE}','cbt',true,null,300`))).state,'ready')
    const first = await result(call(p,'submit_discovery_cbt',`'${f.COURSE}','${f.randomUUID()}',0,0,'{}'`))
    const requests = [call(p,'discovery_preview',`'${f.COURSE}','cbt',false,null,300`),
      call(p,'save_discovery_cbt',`'${f.COURSE}','${f.randomUUID()}',0,0,'{}'`),
      call(p,'submit_discovery_cbt',`'${f.COURSE}','${f.randomUUID()}',0,0,'{}'`)]
    const held = await f.hold(`select pg_advisory_xact_lock(hashtextextended('entitlement-account:${p.user}',0))`)
    const racers = requests.map((request,i) => f.background(`/* a2-free-${p.user}-${i} */ ${request}`))
    try { await f.until(() => requests.every((_,i) => f.waiting(`a2-free-${p.user}-${i}`)),'all free exam reads queued') }
    finally { await held.release() }
    for (const r of await Promise.all(racers)) {
      const out = f.state(r)
      assert.deepEqual(out.preview.result,first.preview.result)
      assert.deepEqual(out.preview.questions,[])
      assert.doesNotMatch(JSON.stringify(out),/correct_option|explanation|"selected"/)
    }
  } finally { f.cleanup(p) }
})

test('Gmail aliases racing activation claim one pass, with old-form lookups retained', { skip: !f.enabled }, async () => {
  const a=f.student({source:null}), b=f.student({source:null})
  try {
    const stem='a2'+f.randomUUID().replaceAll('-','')
    const emails=[`${stem.slice(0,4)}.${stem.slice(4)}+one@googlemail.com`,`${stem}+two@gmail.com`]
    f.sql(`update auth.users set email='${emails[0]}' where id='${a.user}'; update auth.users set email='${emails[1]}' where id='${b.user}'`)
    const keys=readClaimHashKeys({ENTITLEMENT_CLAIM_HASH_KEYS:'991:'+ 'fixture-only-'.repeat(4)})
    // Keep any versions used by earlier suites from invalidating this independent local fixture.
    const registry=f.sql('select count(*) from private.discovery_pass_claims')
    assert.equal(registry,'0','race starts with no retained claims from another suite')
    const request=(p,email)=>call(p,'activate_discovery_pass',`'${JSON.stringify(claimHashes(keys,email))}'::jsonb`)
    const states=(await Promise.all([f.background(request(a,emails[0])),f.background(request(b,emails[1]))])).map(f.state).map(o=>o.state).sort()
    assert.deepEqual(states,['activated','already-claimed'])
  } finally {
    f.sql(`delete from private.discovery_pass_claims where user_id in('${a.user}','${b.user}')`)
    f.cleanup(a);f.cleanup(b)
  }
})

test('plan expiry committed before review gives score only; exam still submits on time', { skip: !f.enabled }, async () => {
  const p=f.student(), id=f.randomUUID()
  try {
    assert.equal((await result(f.service(f.start(p,id)))).state,'ready')
    const ended=`update public.entitlement_grants set ends_at=clock_timestamp()-interval '1 second' where user_id='${p.user}'`
    const out=await queued(`select private.lock_course_access_scope('${p.user}'); ${ended}`,
      call(p,'practice_submit',`'${id}','${f.randomUUID()}',0,0,'{}'`),'submit waits for plan change')
    assert.equal(out.state,'graded');assert.equal(out.attempt.result.score,0)
    assert.deepEqual(out.attempt.questions,[]);assert.equal(out.attempt.review_available,false)
    const review=await result(call(p,'practice_attempt',`'${id}'`))
    assert.deepEqual(review.attempt.questions,[])
    assert.equal(f.attempts(p),1)
  } finally { f.cleanup(p) }
})

test('AI source read queued behind correction sees no outside-list document', { skip: !f.enabled }, async () => {
  const p=f.student({source:'early_access'}), doc=f.randomUUID()
  try {
    f.sql(`update public.entitlement_grants set ai_terms='uncapped',ai_units=null where user_id='${p.user}';
      insert into public.ai_practice_documents(id,user_id,institutional_course_id,storage_path,file_name,media_type,declared_bytes,expires_at)
      values('${doc}','${p.user}','${course()}','${p.user}/${doc}','notes.txt','text/plain',10,now()+interval '1 day')`)
    let held,pending
    try {
      held=await f.hold(f.correction(p))
      const marker='a2-ai-'+f.randomUUID()
      pending=f.background(`/* ${marker} */ ${f.asStudent(p,`select jsonb_build_object('count',count(*)) from public.ai_practice_documents where id='${doc}'`)}`)
      await f.until(()=>f.waiting(marker),'AI RLS waits for correction')
      await held.release();held=null
      assert.equal(f.state(await pending).count,0)
    } finally { if(held)await held.release();if(pending)await pending }
  } finally { f.cleanup(p) }
})
