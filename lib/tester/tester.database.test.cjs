// lib/tester/tester.database.test.cjs — Real concurrent sessions against a LOCAL database for owner tester access
// (20261125200000_owner_tester_access.sql): an Ask message and an Explain request racing for the last of a tester's
// daily cap never reserve past it (exactly one is admitted), and a revocation racing a selection save is decided by
// commit order without a deadlock. Every racer queues behind a held lock first, so the race is real. Opt in:
//   OWNER_TESTER_DB_TEST=1 OWNER_TESTER_DB_CONTAINER=supabase_db_<project> \
//     node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/tester/tester.database.test.cjs
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { until } = require('../payments/campus-bot-race-tools.cjs')

const enabled = process.env.OWNER_TESTER_DB_TEST === '1'
const container = process.env.OWNER_TESTER_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_'), 'set OWNER_TESTER_DB_CONTAINER to the local stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const GST111 = '40000000-0000-4000-8000-000000000008'
const TOPIC = 'Listening Skills and Note-taking'
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const SECOND = '30000000-0000-4000-8000-000000000002'
const users = []
let saved
let siteWasOn

function sql(statement) {
  const result = spawnSync('docker', psql, { input: statement, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function background(statement) {
  const child = spawn('docker', [...psql, '-c', `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let error = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { error += value })
  return new Promise(resolve => child.on('close', code => resolve({ code, out: out.trim().split('\n').pop(), error })))
}
const service = call => `set role service_role; select ${call}::text;`

/** Hold a lock (an advisory key, or any statement that takes one) until every racer queues behind it, then let go. */
async function raceBehind(lock, racers) {
  const marker = `tester-holder-${randomUUID()}`
  const take = lock.startsWith('select') ? lock : `select pg_advisory_xact_lock(hashtextextended('${lock}', 0))`
  const holder = background(`/* ${marker} */ begin; ${take}; select pg_sleep(300); commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the lock holder')
  const tags = racers.map(() => `tester-racer-${randomUUID()}`)
  const running = racers.map((statement, i) => background(`/* ${tags[i]} */ ${statement}`))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and (${tags.map(tag => `query like '%${tag}%'`).join(' or ')}) and query not like '%pg_stat_activity%'`))
    >= racers.length, 'every racer to queue')
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%${marker}%'
    and query not like '%pg_stat_activity%'`)
  await holder
  return Promise.all(running)
}

/** A confirmed student with one session, on BUA 200 Level First Semester, no grant, with tester access. */
function tester(cap = 100000) {
  const user = randomUUID()
  const session = randomUUID()
  users.push(user)
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','${user}','authenticated',
    'authenticated','tester-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';
    insert into private.tester_accounts(user_id,starts_at,expires_at,daily_cap_tokens,set_by,reason,updated_at)
      values('${user}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '7 days',${cap},'operator:race',
        'race test',clock_timestamp());`)
  return { user, session }
}
const topicItem = () => sql(`select i.id from public.managed_content_items i join public.managed_content_revisions r
  on r.item_id=i.id and r.revision=i.published_revision where i.course_id='${GST111}' and i.kind='note'
  and r.payload->'practice' @> '[{"topic":"${TOPIC}"}]' limit 1`)
/** An answered question in a topic practice attempt on GST 111, for Explain. */
function answered(p) {
  const attempt = randomUUID()
  const started = JSON.parse(sql(service(`public.practice_start('${p.session}','${attempt}','${GST111}','new',null,100,10800,
    '[]',null,null,null,'instant','${TOPIC}')`)))
  assert.equal(started.state, 'ready', JSON.stringify(started).slice(0, 200))
  const id = sql(`select question_id from public.quiz_attempt_questions where attempt_id='${attempt}' order by question_id limit 1`)
  const wrong = sql(`select ((r.payload->>'correctOption')::int + 1) % jsonb_array_length(r.payload->'options')
    from public.quiz_attempt_questions q join public.managed_content_revisions r on r.item_id=q.item_id and r.revision=q.content_revision
    where q.attempt_id='${attempt}' and q.question_id='${id}'`)
  assert.equal(JSON.parse(sql(service(`public.practice_pick('${p.session}','${attempt}','${id}',${wrong})`))).state, 'picked')
  return { attempt, id }
}

before(() => {
  if (!enabled) return
  saved = sql(`select explain_enabled||','||ask_enabled from private.campus_bot_settings`)
  siteWasOn = sql('select count(*) from private.tester_site') !== '0'
  sql(`update private.campus_bot_settings set explain_enabled = true, ask_enabled = true where singleton;
    insert into private.tester_site(project_ref,enabled_by,reason) values('znwluaiylogqapansuht','race','race test')
    on conflict do nothing;`)
})
after(() => {
  if (!enabled) return
  const [explain, ask] = saved.split(',')
  sql(`update private.campus_bot_settings set explain_enabled = ${explain === 't'}, ask_enabled = ${ask === 't'} where singleton;
    ${siteWasOn ? '' : 'delete from private.tester_site where singleton;'}`)
  if (users.length) {
    const ids = users.map(id => `'${id}'`).join(',')
    assert.equal(sql(`delete from private.campus_bot_explanations where reply_id in
      (select id from private.campus_bot_replies where user_id in (${ids}));
      delete from auth.users where id in (${ids});
      select count(*) from private.tester_accounts where user_id in (${ids});`), '0', 'the race leaves no rows behind')
  }
})

test('Ask and Explain racing for the last of the daily cap: exactly one is admitted', { skip: !enabled }, async () => {
  const p = tester()
  const { attempt, id } = answered(p)
  // Use most of the day: a delivered tester reply charged 75,000 of the 100,000 cap leaves 25,000, enough for either
  // request (Ask reserves 18,000, Explain 12,000) but not both.
  const first = JSON.parse(sql(service(`public.begin_campus_bot_chat('${p.session}','${randomUUID()}','${GST111}',
    '${topicItem()}',true)`)))
  assert.deepEqual([first.state, first.funding], ['started', 'tester'])
  sql(`update private.campus_bot_replies set state='consumed', charged_tokens=75000, settled_at=clock_timestamp(),
    outcome='answered' where id='${first.reply_id}'`)
  assert.equal(sql(`select private.tester_cap_left('${p.user}', clock_timestamp())`), '25000')
  const results = await raceBehind(`entitlement-account:${p.user}`, [
    service(`public.begin_campus_bot_chat('${p.session}','${randomUUID()}','${GST111}','${topicItem()}',true)`),
    service(`public.begin_campus_bot_explanation('${p.session}','${attempt}','${id}',true)`)])
  for (const r of results) assert.equal(r.code, 0, r.error)
  const states = results.map(r => JSON.parse(r.out).state).sort()
  assert.deepEqual(states, ['session-limit', 'started'], JSON.stringify(states))
  const reserved = Number(sql(`select coalesce(sum(reserved_tokens),0) from private.campus_bot_replies
    where user_id='${p.user}' and state='reserved'`))
  assert.ok(reserved <= 25000, `reserved ${reserved} past what was left`)
  assert.ok(Number(sql(`select private.tester_cap_left('${p.user}', clock_timestamp())`)) >= 0, 'never below zero')
})

test('a revocation racing her selection save: commit order decides, no deadlock', { skip: !enabled }, async () => {
  const p = tester()
  const save = `set local role authenticated; select set_config('request.jwt.claims',
    '{"sub":"${p.user}","session_id":"${p.session}","role":"authenticated"}', true);
    update public.profiles set academic_period_id='${SECOND}' where id='${p.user}' returning 'saved';`
  const revoke = service(`public.admin_set_tester_access('${p.user}','revoke',null,null,'race','race revoke')`)
  // Both need her profile row: the save to update it, the revoke for its account prefix. Hold it, then let both go.
  const results = await raceBehind(`select 1 from public.profiles where id='${p.user}' for update`,
    [`begin; ${revoke} commit;`, `begin; ${save} commit;`])
  // Whichever commits first decides; neither deadlocks or times out.
  for (const r of results) assert.ok(r.code === 0 || /That semester is not running now/.test(r.error), r.error)
  assert.doesNotMatch(results.map(r => r.error).join(''), /deadlock|lock timeout|statement timeout/)
  assert.equal(JSON.parse(results[0].out).state, 'revoked')
  const period = sql(`select academic_period_id from public.profiles where id='${p.user}'`)
  if (results[1].code === 0) assert.equal(period, SECOND, 'a save that committed first kept her semester')
  else assert.equal(period, FIRST, 'a save after the revoke met the running-semester rule')
})
