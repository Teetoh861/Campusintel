// Real sessions and bounded lock holders on an explicitly selected LOCAL test database.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const enabled = process.env.PRACTICE_DB_TEST === '1'
const container = process.env.PRACTICE_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_'), 'set PRACTICE_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const FREE = '40000000-0000-4000-8000-000000000008'
const PLAN = '40000000-0000-4000-8000-000000000007'
const TAB = 'cccccccc-cccc-4ccc-8ccc-000000000001'
function sql(statement) {
  const r = spawnSync('docker', [...psql, '-c', statement], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function background(statement, name) {
  const child = spawn('docker', [...psql, '-c', `set application_name='${name}'; set statement_timeout='25s'; set lock_timeout='20s'; ${statement}`])
  let out = '', error = ''
  child.stdout.on('data', value => { out += value }); child.stderr.on('data', value => { error += value })
  return new Promise((resolve, reject) => child.on('error', reject).on('close', code =>
    code === 0 ? resolve(out.trim()) : reject(new Error(error))))
}
async function until(check, label) {
  const start = Date.now()
  while (!check()) {
    assert.ok(Date.now() - start < 15_000, `timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 40))
  }
}
async function hold(lock) {
  const name = `practice-review-holder-${randomUUID()}`
  const pending = background(`begin; ${lock}; select pg_sleep(20); rollback;`, name).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`) === '1', 'lock holder')
  return async () => {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${name}'`)
    await pending
  }
}
/** Start the request, prove it is waiting, change the fixture, and release only this test's holder. */
async function queued(call, lock, whileWaiting) {
  const release = await hold(lock), name = `practice-review-request-${randomUUID()}`
  const pending = background(`set role service_role; select ${call}::text;`, name)
  pending.catch(() => undefined)
  let result
  try {
    await until(() => sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock'`) === '1', 'request to queue')
    await whileWaiting()
  } finally { await release(); result = await pending }
  return JSON.parse(result)
}
function student() {
  const p = { user: randomUUID(), session: randomUUID() }
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('00000000-0000-0000-0000-000000000000','${p.user}','authenticated','authenticated','review-${p.user}@example.test','x',now(),
      '{"provider":"email","providers":["email"]}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${p.session}','${p.user}',now(),now());
    update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
      academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
      where id='${p.user}';
    insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
      values('${p.user}','manual',now()-interval '1 day',now()+interval '1 day','none','practice-review-test');`)
  return p
}
const cleanup = p => sql(`delete from auth.users where id='${p.user}'`)
const service = call => JSON.parse(sql(`set role service_role; select ${call}::text;`))
// Also runs before the follow-up migration: the old start demonstrates that unchanged count/time misses this mode.
function start(p, id, course = FREE, whole = false) {
  const extra = sql(`select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='practice_start' and 'p_expected_whole_bank'=any(p.proargnames))`) === 't'
  return `public.practice_start('${p.session}','${id}','${course}','new',null,50,1800,'[]',50,1800${extra ? ',' + whole : ''})`
}
function begin(p) {
  const id = randomUUID()
  assert.equal(service(start(p, id)).state, 'ready')
  return id
}
const answer = id => JSON.parse(sql(`select jsonb_build_object(q.question_id::text, r.payload->'correctOption')
  from public.quiz_attempt_questions q join public.managed_content_revisions r on r.item_id=q.item_id and r.revision=q.content_revision
  where q.attempt_id='${id}' order by ordinal limit 1`))
const delta = (p, id, action) => `public.practice_${action}('${p.session}','${id}','${TAB}',1,0,'${JSON.stringify(answer(id))}')`
module.exports = { enabled, FREE, PLAN, TAB, sql, queued, student, cleanup, service, start, begin, answer, delta, until, randomUUID }
