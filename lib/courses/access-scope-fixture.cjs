// Only the explicitly selected, isolated local database. Never inherit a default suite container.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const enabled = process.env.ACCESS_SCOPE_DB_TEST === '1'
const container = process.env.ACCESS_SCOPE_DB_CONTAINER
if (enabled) assert.match(container ?? '', /^supabase_db_ci-access-own-[a-z0-9-]+$/)
const prefix = ['exec', '-i', container, 'psql', '-XAtq', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
const BUA = '10000000-0000-4000-8000-000000000002', ACC = '10000000-0000-4000-8000-000000000001'
const L200 = '20000000-0000-4000-8000-000000000002', L100 = '20000000-0000-4000-8000-000000000001'
const FIRST = '30000000-0000-4000-8000-000000000001', COURSE = '40000000-0000-4000-8000-000000000002'

// The caller owns power preflight; explicitly selected touched tests remain runnable below 20%.
function sql(statement, { cleanup = false } = {}) {
  assert.ok(enabled)
  const result = spawnSync('docker', prefix, { input: statement, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function background(statement) {
  const child = spawn('docker', [...prefix, '-c', `set statement_timeout='20s'; set lock_timeout='15s'; ${statement}`],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { err += value })
  return new Promise(resolve => {
    child.on('error', error => resolve({ code: -1, out, err: String(error) }))
    child.on('close', code => resolve({ code, out: out.trim(), err }))
  })
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, label) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 10_000) throw new Error('Timed out: ' + label)
    await delay(25)
  }
}
const waiting = marker => Number(sql(`select count(*) from pg_stat_activity where wait_event_type='Lock'
  and query like '%${marker}%' and query not like '%pg_stat_activity%'`)) > 0

/** Hold a real completed operation in an uncommitted transaction, then prove another operation queues behind it. */
async function hold(statement) {
  const gate = 'access-scope-gate-' + randomUUID(), marker = 'access-scope-holder-' + randomUUID()
  const blocker = background(`select pg_advisory_lock(hashtextextended('${gate}',0)); select pg_sleep(18);`)
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event='PgSleep'
    and query like '%${gate}%'`)) > 0, 'gate')
  const holder = background(`/* ${marker} */ begin; ${statement}; reset role;
    select pg_advisory_lock(hashtextextended('${gate}',0)); commit;`)
  try { await until(() => waiting(marker), 'holder to finish its operation') }
  catch (error) {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%${gate}%'
      and query not like '%pg_stat_activity%'`)
    await Promise.all([holder, blocker]); throw error
  }
  return { release: async () => {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event='PgSleep' and query like '%${gate}%'`, { cleanup: true })
    await blocker
    const result = await holder
    assert.equal(result.code, 0, result.err)
    return result.out
  } }
}

function student({ future = false, expires = false, source = 'manual' } = {}) {
  const user = randomUUID(), session = randomUUID()
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','${user}',
    'authenticated','authenticated','scope-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';
    ${source === null ? '' : `insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
      values('${user}','${source}',clock_timestamp()+interval '${future ? '2 seconds' : '-1 day'}',
        clock_timestamp()+interval '${expires ? '2 seconds' : '1 day'}','none','scope-race');`}`)
  return { user, session }
}
const claims = p => JSON.stringify({ sub: p.user, session_id: p.session, role: 'authenticated' })
const asStudent = (p, statement) => `set role authenticated; set request.jwt.claims='${claims(p)}'; ${statement}`
const service = statement => `set role service_role; ${statement}`
const start = (p, id = randomUUID(), course = COURSE) => `select public.practice_start('${p.session}','${id}','${course}',
  'new',null,1,300,'[]',1,300,false)::text`
// An instant practice start on one topic, as practice by topic makes it.
const topicStart = (p, topic, id = randomUUID(), course = COURSE) => `select public.practice_start('${p.session}','${id}',
  '${course}','new',null,1,300,'[]',null,null,null,'instant','${topic.replace(/'/g, "''")}')::text`
const save = p => asStudent(p, `update public.profiles set department_id='${ACC}',academic_level_id='${L100}'
  where id='${p.user}' returning revision`)
const correction = p => service(`select public.admin_change_course_selection('${p.user}','accounting','100-level',
  'first-semester',${Number(sql(`select revision from public.profiles where id='${p.user}'`))},false,'Ops','requested correction')::text`)
const cleanup = p => sql(`delete from auth.users where id='${p.user}'`, { cleanup: true })
const department = p => sql(`select department_id from public.profiles where id='${p.user}'`)
const attempts = p => Number(sql(`select count(*) from public.quiz_attempts where user_id='${p.user}'`))
const state = result => {
  assert.equal(result.code, 0, result.err)
  return JSON.parse(result.out.split('\n').at(-1))
}

// The free month claim (Early Access) as the server sends it: the session, the keyed hashes of its address and the
// profile revision the page showed. Plain digests stand in for the HMACs, under this suite's own key version, with
// every other registered version presented with its check so the ledger's integrity rules are satisfied.
const CLAIM_KEY_VERSION = 903
const digest = value => `encode(sha256(convert_to('${value}', 'UTF8')), 'hex')`
function claimHashes(p) {
  const email = `scope-race-${p.user}@example.test`
  const others = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('version', key_version, 'check', key_check)), '[]')
    from private.discovery_claim_keys where key_version <> ${CLAIM_KEY_VERSION}`))
  return `jsonb_build_array(${[`jsonb_build_object('version', ${CLAIM_KEY_VERSION}, 'hash',
    ${digest(`claim-v${CLAIM_KEY_VERSION}:${email}`)}, 'check', ${digest(`claim-key-check-v${CLAIM_KEY_VERSION}`)})`,
  ...others.map(k => `jsonb_build_object('version', ${k.version}, 'hash', ${digest(`claim-v${k.version}:${email}`)},
    'check', '${k.check}')`)].join(', ')})`
}
const revision = p => Number(sql(`select revision from public.profiles where id='${p.user}'`))
const claimMonth = (p, seen = revision(p)) => service(
  `select public.claim_early_access('${p.session}', ${claimHashes(p)}, ${seen})::text`)
/** The claim open for one test (launched a day ago, the cutoff far off); restore() puts the policy row back. */
function openClaim() {
  const restore = sql(`select format('update private.entitlement_policy set actual_launch_at = %L::timestamptz,
    early_access_enrollment_days = %s, early_access_claim_cutoff = %L::timestamptz', actual_launch_at,
    early_access_enrollment_days, early_access_claim_cutoff) from private.entitlement_policy`)
  sql(`update private.entitlement_policy set actual_launch_at = now() - interval '1 day',
    early_access_enrollment_days = 10, early_access_claim_cutoff = now() + interval '60 days'`)
  return { restore: () => sql(restore, { cleanup: true }) }
}
/** Before the account goes: a record left behind would keep this suite's key version needed for ever. */
const releaseClaims = p => sql(`delete from private.early_access_claims where user_id='${p.user}'
  or key_version = ${CLAIM_KEY_VERSION}`, { cleanup: true })
module.exports = { enabled, sql, background, hold, waiting, until, delay, student, asStudent, service,
  start, topicStart, save, correction, cleanup, department, attempts, state, randomUUID, BUA, ACC, COURSE,
  claimMonth, openClaim, releaseClaims, revision }
