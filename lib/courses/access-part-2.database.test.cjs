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
  const p=f.student({source:null}), doc=f.randomUUID()
  try {
    f.sql(`insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
      values('${p.user}','early_access',now()-interval '1 day',now()+interval '1 day','uncapped','a2-race');
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

function aiStudent() {
  const p=f.student({source:null})
  f.sql(`insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
    values('${p.user}','early_access',now()-interval '1 day',now()+interval '1 day','uncapped','a2-race')`)
  return p
}
async function document(p,ready=false) {
  const doc=await result(call(p,'create_ai_practice_document',`'${course()}','notes.txt','text/plain',10,array['early_access']`))
  assert.equal(doc.status,'created')
  if(ready) f.sql(`update public.ai_practice_documents set status='ready',source_text='ready notes',
    source_sha256=encode(sha256(convert_to('ready notes','UTF8')),'hex'),word_count=2 where id='${doc.document_id}'`)
  return doc.document_id
}
const personalSet=JSON.stringify({formatVersion:1,origin:'ai-generated',visibility:'personal',verification:'unverified',questions:[{id:'q1'}]})

for(const operation of ['reserve','claim','settle','begin','finish']) test(`AI ${operation} waits for correction and rechecks the course before proceeding`,{skip:!f.enabled},async()=>{
  const p=aiStudent()
  try {
    const id=operation==='reserve'?null:await document(p,['begin','finish'].includes(operation))
    let request, expected
    if(operation==='reserve'){
      request=call(p,'create_ai_practice_document',`'${course()}','notes.txt','text/plain',10,array['early_access']`)
      expected={status:'not-entitled'}
    }else if(operation==='claim'){
      request=call(p,'claim_ai_practice_extraction',`'${id}'`);expected={state:'not-found'}
    }else if(operation==='settle'){
      const claimed=await result(call(p,'claim_ai_practice_extraction',`'${id}'`));assert.equal(claimed.state,'claimed')
      request=call(p,'settle_ai_practice_document',`'${id}','${claimed.claim_id}',null,'ready notes',encode(sha256(convert_to('ready notes','UTF8')),'hex'),2`)
      expected=false
    }else if(operation==='begin'){
      request=call(p,'begin_ai_practice_generation',`'${f.randomUUID()}','${id}',array['early_access']`);expected={state:'not-entitled'}
    }else{
      const begun=await result(call(p,'begin_ai_practice_generation',`'${f.randomUUID()}','${id}',array['early_access']`));assert.equal(begun.state,'started')
      request=f.service(`select public.finish_ai_practice_generation('${p.user}','${begun.generation_id}','generated',null,'${personalSet}',null)::text`)
      expected={state:'finished',status:'failed'}
    }
    const out=await queued(f.correction(p),request,`AI ${operation} queues behind correction`)
    assert.deepEqual(out,expected)
    assert.equal(f.sql(`select count(*) from public.ai_practice_generations where user_id='${p.user}' and question_set is not null`),'0')
    if(operation==='settle')assert.equal(f.sql(`select source_text is null from public.ai_practice_documents where id='${id}'`),'t')
  }finally{f.cleanup(p)}
})

test('a generated set stays owner-readable after correction, while its source and new generation close',{skip:!f.enabled},async()=>{
  const p=aiStudent()
  try {
    const id=await document(p,true)
    const begun=await result(call(p,'begin_ai_practice_generation',`'${f.randomUUID()}','${id}',array['early_access']`))
    const finished=await result(f.service(`select public.finish_ai_practice_generation('${p.user}','${begun.generation_id}','generated',null,'${personalSet}',null)::text`))
    assert.equal(finished.status,'generated')
    const out=await queued(f.correction(p),f.asStudent(p,`select jsonb_build_object('sets',(select count(*) from public.ai_practice_generations),
      'sources',(select count(*) from public.ai_practice_documents))`),'owner reads wait for correction')
    assert.deepEqual(out,{sets:1,sources:0})
  }finally{f.cleanup(p)}
})

test('instant answer reveal queued behind plan revocation returns no correctness or explanation',{skip:!f.enabled},async()=>{
  const p=f.student(),id=f.randomUUID()
  try{
    assert.equal((await result(f.service(f.topicStart(p,'Ethics & CSR',id)))).state,'ready')
    const q=f.sql(`select question_id from public.quiz_attempt_questions where attempt_id='${id}' order by ordinal limit 1`)
    const out=await queued(`select private.lock_course_access_scope('${p.user}');update public.entitlement_grants set revoked_at=clock_timestamp(),revoked_by='Ops',revoke_reason='race' where user_id='${p.user}'`,call(p,'practice_pick',`'${id}','${q}',0`),'pick waits for revocation')
    assert.equal(out.state,'locked');assert.doesNotMatch(JSON.stringify(out),/correct|explanation/)
    assert.equal(f.sql(`select count(*) from public.quiz_attempt_answers where attempt_id='${id}'`),'0')
  }finally{f.cleanup(p)}
})

test('bookmark survives queued course correction; the new course decision closes its material and counts',{skip:!f.enabled},async()=>{
  const p=f.student()
  try{
    f.sql(`insert into public.student_bookmarks(user_id,course_id)values('${p.user}','${f.COURSE}')`)
    const out=await queued(f.correction(p),f.asStudent(p,`select jsonb_build_object('bookmarks',(select count(*) from public.student_bookmarks),
      'allowed',(select allowed from public.get_my_course_access(array['${course()}'::uuid])))`),'bookmark reader waits for the corrected selection')
    assert.deepEqual(out,{bookmarks:1,allowed:false})
    for(const query of [`select count(*) from public.read_published_managed_content('${f.COURSE}')`,
      `select * from public.published_cbt_summary(array['${f.COURSE}'::uuid])`]){
      const denied=await f.background(f.asStudent(p,query));assert.notEqual(denied.code,0);assert.match(denied.err,/Course access requires an active plan/)
    }
  }finally{f.cleanup(p)}
})

test('a throwaway email committed while activation waits has no offer and receives no pass',{skip:!f.enabled},async()=>{
  const p=f.student({source:null})
  try{
    const keys=readClaimHashKeys({ENTITLEMENT_CLAIM_HASH_KEYS:'991:'+'fixture-only-'.repeat(4)})
    const hashes=JSON.stringify(claimHashes(keys,'a2-'+p.user+'@example.test'))
    const out=await queued(`update auth.users set email='a2-${p.user}@mailinator.com' where id='${p.user}'`,call(p,'activate_discovery_pass',`'${hashes}'::jsonb`),'activation waits for the verified email change')
    assert.equal(out.state,'trial-not-offered')
    assert.equal((await result(call(p,'discovery_pass_eligibility',`'${hashes}'::jsonb`))).eligible,false)
    assert.equal(f.sql(`select count(*) from public.entitlement_grants where user_id='${p.user}'`),'0')
  }finally{f.cleanup(p)}
})

for(const kind of ['selection','allowance'])test(`Storage object insert rechecks ${kind} after its final wait`,{skip:!f.enabled},async()=>{
  const p=aiStudent();let held,pending
  try{
    const id=await document(p),name=p.user+'/'+id
    if(kind==='selection')held=await f.hold(f.correction(p))
    else{
      f.sql(`update public.entitlement_grants set ends_at=clock_timestamp()+interval '3 seconds' where user_id='${p.user}'`)
      held=await f.hold(`select pg_advisory_xact_lock(hashtextextended('ai-practice-storage:${name}',0))`)
    }
    const marker='a2-storage-'+f.randomUUID()
    pending=f.background(`/* ${marker} */ set role service_role;insert into storage.objects(bucket_id,name)values('ai-practice-uploads','${name}')`)
    await f.until(()=>f.waiting(marker),'actual Storage insert reaches its authorization wait')
    if(kind==='allowance')await f.until(()=>f.sql(`select bool_and(ends_at<=clock_timestamp())from public.entitlement_grants where user_id='${p.user}'`)==='t','AI allowance expires while queued')
    await held.release();held=null
    const refused=await pending;assert.notEqual(refused.code,0);assert.match(refused.err,/AI upload slot unavailable/)
    assert.equal(f.sql(`select count(*)from storage.objects where bucket_id='ai-practice-uploads' and name='${name}'`),'0')
  }finally{if(held)await held.release();if(pending)await pending;f.cleanup(p)}
})
