const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./access-scope-fixture.cjs')
const INST = '50000000-0000-4000-8000-000000000072'
const OUTSIDE = '50000000-0000-4000-8000-000000000077'
const OUTSIDE_REPOSITORY = '40000000-0000-4000-8000-000000000011'
// A topic of each course, for practice by topic starts.
const TOPIC = { [f.COURSE]: 'Ethics & CSR',
  [OUTSIDE_REPOSITORY]: "Week 10 — Nigeria's Banking, Financial System, and Securities Market" }
const reads = [
  `select * from public.get_my_course_access(array['${INST}'::uuid])`,
  `select count(*) from public.read_published_managed_content('${f.COURSE}')`,
  `select * from public.published_cbt_summary(array['${f.COURSE}'::uuid])`,
  `select * from public.published_cbt_topics('${f.COURSE}','[]')`,
]
const quick = promise => Promise.race([promise, f.delay(2000).then(() => { throw new Error('A compatible read queued') })])
const pending = p => f.sql(`update public.entitlement_grants set course_term_id=null,course_department_id=null where user_id='${p.user}';
  delete from private.entitlement_events where user_id='${p.user}' and event='course.grant-bound'`)
const bindings = p => Number(f.sql(`select count(*) from private.entitlement_events where user_id='${p.user}' and event='course.grant-bound'`))
function add(p, key = f.randomUUID()) {
  const revision = Number(f.sql(`select revision from public.profiles where id='${p.user}'`))
  const term = f.sql(`select (private.current_course_scope('${p.user}',clock_timestamp())->>'term_id')`)
  return `select public.admin_add_student_course('${p.user}','${OUTSIDE}','${term}',${revision},'${key}','Ops','review race')::text`
}

for (const [index, read] of reads.entries()) test(`shared read ${index + 1}: other course readers complete while its transaction stays open`, { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racers = []
  try {
    held = await f.hold(f.asStudent(p, read))
    racers = reads.map(statement => f.background(f.asStudent(p, statement)))
    for (const result of await quick(Promise.all(racers))) assert.equal(result.code, 0, result.err)
    // The shared path takes no grant row locks either.
    const grant = await quick(f.background(`begin; select id from public.entitlement_grants where user_id='${p.user}' for update nowait; rollback;`))
    assert.equal(grant.code, 0, grant.err)
  } finally { if (held) await held.release(); await Promise.all(racers); f.cleanup(p) }
})

test('an exclusive grant write waits for an in-flight shared course read', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racer
  try {
    held = await f.hold(f.asStudent(p, reads[0]))
    const marker = 'scope-write-after-read-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(`select public.admin_grant_access('${p.user}',1,'Ops','review race')::text`)}`)
    await f.until(() => f.waiting(marker), 'exclusive writer to wait for shared reader')
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'granted')
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('two reads seeing one pending grant both finish and bind exactly once, without lock upgrades', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racers = []
  try {
    pending(p)
    held = await f.hold(`select pg_advisory_xact_lock(hashtextextended('entitlement-account:${p.user}',0))`)
    const markers = [f.randomUUID(), f.randomUUID()]
    racers = markers.map((marker,index) => f.background(`/* ${marker} */ ${f.asStudent(p, reads[index])}`))
    for (const marker of markers) await f.until(() => f.waiting(marker), 'both readers to see pending before waiting')
    await held.release(); held = null
    for (const result of await Promise.all(racers)) assert.equal(result.code, 0, result.err)
    assert.equal(bindings(p), 1)
    assert.notEqual(f.sql(`select course_term_id from public.entitlement_grants where user_id='${p.user}'`), '')
  } finally { if (held) await held.release(); await Promise.all(racers); f.cleanup(p) }
})

test('binding locks only changing grants, leaving an already bound row free', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held
  try {
    const bound = f.sql(`select id from public.entitlement_grants where user_id='${p.user}'`)
    f.sql(`insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
      values('${p.user}','paid',now(),now()+interval '1 day','none','review race');
      update public.entitlement_grants set course_term_id=null,course_department_id=null where user_id='${p.user}' and source='paid'`)
    held = await f.hold(`select private.lock_course_access_scope('${p.user}'); select private.bind_pending_course_grants('${p.user}')`)
    const result = await quick(f.background(`begin; select id from public.entitlement_grants where id='${bound}' for update nowait; rollback`))
    assert.equal(result.code, 0, result.err)
  } finally { if (held) await held.release(); f.cleanup(p) }
})

for (const [addition, topic] of [[false, false], [true, false], [false, true], [true, true]]) test(`${addition ? 'addition' : 'grant'} revoke commits while ${topic ? 'a topic' : 'practice'} start waits: no attempt is created`, { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racer
  try {
    let revoke
    if (addition) {
      const added = f.state(await f.background(f.service(add(p))))
      assert.equal(added.state, 'added')
      revoke = `select public.admin_revoke_student_course('${p.user}','${added.id}',1,'Ops','review race')::text`
    } else {
      const grant = f.sql(`select id from public.entitlement_grants where user_id='${p.user}'`)
      revoke = `select public.admin_change_grant('${grant}','revoke',null,null,'Ops','review race')::text`
    }
    held = await f.hold(f.service(revoke))
    const marker = 'scope-revoke-before-start-' + f.randomUUID()
    const course = addition ? OUTSIDE_REPOSITORY : f.COURSE
    racer = f.background(`/* ${marker} */ ${f.service(topic ? f.topicStart(p,TOPIC[course],undefined,course) : f.start(p,undefined,course))}`)
    await f.until(() => f.waiting(marker), 'practice start waits for revoke commit')
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'locked')
    assert.equal(f.attempts(p), 0)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('racing topic starts with a pending grant bind it once and start one run', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racers = []
  try {
    pending(p)
    held = await f.hold(`select pg_advisory_xact_lock(hashtextextended('entitlement-account:${p.user}',0))`)
    const markers = [f.randomUUID(), f.randomUUID()]
    racers = markers.map(marker => f.background(`/* ${marker} */ ${f.service(f.topicStart(p, TOPIC[f.COURSE]))}`))
    for (const marker of markers) await f.until(() => f.waiting(marker), 'both starts to queue behind the account lock')
    await held.release(); held = null
    const states = (await Promise.all(racers)).map(result => f.state(result).state).sort()
    assert.deepEqual(states, ['in-progress', 'ready'], 'the second start is handed the run the first started')
    assert.equal(bindings(p), 1)
    assert.equal(f.attempts(p), 1)
  } finally { if (held) await held.release(); await Promise.all(racers); f.cleanup(p) }
})

for (const sameKey of [true,false]) test(`concurrent additions with ${sameKey ? 'one request key' : 'two request keys'} create one active row`, { skip: !f.enabled }, async () => {
  const p = f.student(), key = f.randomUUID()
  let held, racer
  try {
    const first = add(p,key), second = add(p,sameKey ? key : f.randomUUID())
    held = await f.hold(f.service(first))
    const marker = 'scope-add-race-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(second)}`)
    await f.until(() => f.waiting(marker), 'second addition waits for first commit')
    const firstResult = JSON.parse((await held.release()).split('\n').filter(line => line.startsWith('{')).at(-1)); held = null
    const secondResult = f.state(await racer)
    assert.equal(firstResult.state, 'added')
    assert.equal(secondResult.state, sameKey ? 'existing' : 'already-added')
    if (sameKey) {
      assert.equal(firstResult.id, secondResult.id)
      assert.equal(firstResult.revision, secondResult.revision)
      assert.equal(firstResult.ends_at, secondResult.ends_at)
    }
    assert.equal(Number(f.sql(`select count(*) from private.student_course_additions where user_id='${p.user}' and revoked_at is null`)),1)
    assert.equal(Number(f.sql(`select count(*) from private.course_selection_events where user_id='${p.user}' and event='operator.course-added'`)),1)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

// Policy changes and list imports below are confined to the explicitly named disposable stack.
for (const action of ['import','member-change','email-confirmation']) test(`Early Access ${action} with a profile save in flight completes or defers and sweeps`, { skip: !f.enabled }, async () => {
  const p = f.student({source:null})
  let held, racer, profile
  const email = `scope-race-${p.user}@example.test`, nextEmail = `scope-confirm-${p.user}@example.test`
  const policy = f.sql('select row_to_json(p)::text from private.entitlement_policy p')
  try {
    f.sql(`update private.entitlement_policy set actual_launch_at=now()-interval '1 day'`)
    if (action !== 'import') f.sql(`insert into private.early_access_members(email,full_name,joined_at,source,batch,added_by,excluded_at,excluded_reason)
      values('${action === 'email-confirmation' ? nextEmail : email}','Ada',now()-interval '2 days','manual','review race','Ops',
        ${action === 'member-change' ? "now(),'fixture hold'" : 'null,null'})`)
    if (action === 'email-confirmation') {
      // Pause a real student save after it owns the profile but before its lock-free lifecycle check.
      // Confirmation can then own Auth UPDATE and must defer its profile NOWAIT until the save commits.
      const gate = 'scope-before-auth-' + f.randomUUID()
      f.sql(`create function private.access_review_profile_before_auth() returns trigger language plpgsql security definer as $$
        begin if new.id='${p.user}'::uuid then perform pg_advisory_xact_lock(hashtextextended('${gate}',0)); end if; return new; end $$;
        create trigger profiles_aaa_access_review before update of first_name on public.profiles
          for each row execute function private.access_review_profile_before_auth()`)
      held = await f.hold(`select pg_advisory_xact_lock(hashtextextended('${gate}',0))`)
      const marker = 'scope-profile-before-auth-' + f.randomUUID()
      profile = f.background(`/* ${marker} */ ${f.asStudent(p,`update public.profiles set first_name='Ada updated' where id='${p.user}'`)}`)
      await f.until(() => f.waiting(marker), 'student save owns profile before lifecycle check')
    } else held = await f.hold(f.asStudent(p,`update public.profiles set first_name='Ada updated' where id='${p.user}'`))
    const marker = 'scope-ea-profile-' + f.randomUUID()
    const command = action === 'import'
      ? f.service(`select public.admin_add_early_access_member('${email}','Ada',null,now()-interval '2 days','manual','review race','Ops')::text`)
      : action === 'member-change'
        ? f.service(`select public.admin_change_early_access_member('${email}','include',null,'Ops','review race')::text`)
        : `update auth.users set email='${nextEmail}',email_confirmed_at=clock_timestamp() where id='${p.user}'; select jsonb_build_object('state','confirmed')::text`
    racer = f.background(`/* ${marker} */ ${command}`)
    if (action !== 'email-confirmation') await f.until(() => f.waiting(marker), 'operator safely waits for profile before member/grant rows')
    else {
      const result = await quick(racer)
      assert.equal(result.code,0,result.err)
      assert.doesNotMatch(result.err,/55P03/)
      assert.equal(Number(f.sql(`select count(*) from public.entitlement_grants where user_id='${p.user}' and source='early_access'`)),0)
    }
    await held.release(); held = null
    if (profile) { const saved = await profile; assert.equal(saved.code,0,saved.err) }
    const result = await racer
    assert.equal(result.code,0,result.err)
    assert.doesNotMatch(result.err,/55P03/)
    const sweep = f.sql(`select private.reconcile_all_early_access('review sweep',500)::text`)
    assert.ok(JSON.parse(sweep).granted >= 0)
    assert.equal(Number(f.sql(`select count(*) from public.entitlement_grants where user_id='${p.user}' and source='early_access'`)),1)
  } finally {
    if (held) await held.release(); if (racer) await racer; if (profile) await profile
    if (action === 'email-confirmation') f.sql('drop trigger if exists profiles_aaa_access_review on public.profiles; drop function if exists private.access_review_profile_before_auth()')
    f.cleanup(p)
    f.sql(`delete from private.early_access_members where email in ('${email}','${nextEmail}');
      update private.entitlement_policy set actual_launch_at=${JSON.parse(policy).actual_launch_at === null ? 'null' : `'${JSON.parse(policy).actual_launch_at}'::timestamptz`}`)
  }
})


test('a grant found unbound after a shared read fails closed without upgrading the transaction', { skip: !f.enabled }, async()=>{
  const p=f.student()
  try {
    const result=f.state(await f.background(`begin; ${f.asStudent(p,reads[0])}; reset role;
      update public.entitlement_grants set course_term_id=null,course_department_id=null where user_id='${p.user}';
      ${f.asStudent(p,`select jsonb_build_object('reason',(select reason from public.get_my_course_access(array['${INST}'::uuid])),
        'exclusive',exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and mode='ExclusiveLock'
          and classid=((hashtextextended('entitlement-account:${p.user}',0)>>32)&4294967295)::oid
          and objid=(hashtextextended('entitlement-account:${p.user}',0)&4294967295)::oid and objsubid=1))::text`)}; rollback`))
    assert.equal(result.reason,'needs-plan')
    assert.equal(result.exclusive,false)
  } finally {f.cleanup(p)}
})
