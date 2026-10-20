// lib/entitlements/discovery.database.test.cjs — Real concurrent sessions against a LOCAL database for the Discovery
// Pass: racing opens on different courses pin exactly one preview, racing submissions grade once, racing AI admissions
// respect the attempt limit, and expiry follows the database's wall clock (72-hour pass, 50-question timed exam).
// Needs 20261021100000_discovery_pass.sql. Opt in: ENTITLEMENT_DB_TEST=1 [ENTITLEMENT_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.ENTITLEMENT_DB_TEST === '1'
const container = process.env.ENTITLEMENT_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// Repository course fixtures with published CBT questions; 07 also has notes and worked theory.
const COURSES = ['02', '03', '04', '07', '01', '06', '11', '12'].map(n => `40000000-0000-4000-8000-0000000000${n}`)

function sql(statement) {
  const result = spawnSync('docker', [...psql, '-c', statement], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function background(statement) {
  const child = spawn('docker', [...psql, '-c', statement], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let error = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { error += value })
  return new Promise((resolve, reject) => child.on('error', reject).on('close', code => {
    if (code !== 0) reject(new Error(error)); else resolve(out.trim())
  }))
}

const strict = statement => `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`
const asService = call => strict(`set role service_role; select ${call};`)
const until = async (predicate, label) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** Hold the per-account lock every Discovery path takes, so all racers provably queue before any runs. */
async function holdAccount(userId, racers) {
  const key = `entitlement-account:${userId}`
  const marker = `discovery-test-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0));
    select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the account lock holder')
  const running = racers.map(statement => background(statement))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%discovery%' and query not like '%pg_stat_activity%'`)) >= racers.length, 'every racer to queue')
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
  await holder
  return Promise.all(running)
}

/** One confirmed student with a live session and an active pass of the default length. */
function student() {
  const user = randomUUID()
  const session = randomUUID()
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
      'discovery-${user}@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());
    insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
      select '${user}', 'trial', now(), now() + make_interval(hours => discovery_hours), 'capped',
        discovery_ai_generations, 'discovery-db-test' from private.entitlement_policy;`)
  return { user, session }
}

const cleanup = users => sql(`delete from auth.users where id in (${users.map(id => `'${id}'`).join(',')})`)

test('racing opens on eight courses pin exactly one CBT exam', { skip: !enabled }, async () => {
  const p = student()
  try {
    const results = await holdAccount(p.user, COURSES.map(course =>
      asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)))
    assert.deepEqual(results.filter(state => state === 'ready').length, 1, results.join(','))
    assert.deepEqual(results.filter(state => state === 'used-elsewhere').length, CONCURRENCY - 1)
    assert.equal(sql(`select count(*) from private.discovery_previews where user_id = '${p.user}'`), '1')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${p.user}'
      and event = 'discovery.preview-opened'`), '1', 'one audited open')
  } finally { cleanup([p.user]) }
})

test('racing submissions with different answers grade once and agree', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)),
      'ready')
    const keys = sql(`select string_agg(q ->> 'item_id' || ':' || (q ->> 'correct_option') || ':' ||
        jsonb_array_length(q -> 'options'), ',') from private.discovery_previews p, jsonb_array_elements(p.content) q
      where p.user_id = '${p.user}'`).split(',').map(row => row.split(':'))
    // Racer i answers its first i questions correctly, so each racer would score differently.
    const answers = Array.from({ length: CONCURRENCY }, (_, i) => JSON.stringify(Object.fromEntries(keys.map(
      ([item, correct, options], index) => [item, index < i ? Number(correct) : (Number(correct) + 1) % Number(options)]))))
    const scores = await holdAccount(p.user, answers.map(body =>
      asService(`public.submit_discovery_cbt('${p.session}', '${course}', '${body}') -> 'preview' -> 'result' ->> 'score'`)))
    assert.equal(new Set(scores).size, 1, `every caller sees the one grading: ${scores.join(',')}`)
    assert.equal(sql(`select score::text from private.discovery_previews where user_id = '${p.user}'`), scores[0])
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${p.user}'
      and event = 'discovery.exam-submitted'`), '1', 'graded once')
  } finally { cleanup([p.user]) }
})

test('racing AI admissions never exceed the pass attempt limit', { skip: !enabled }, async () => {
  const p = student()
  try {
    const document = randomUUID()
    sql(`insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name,
        media_type, declared_bytes, expires_at, status, source_text, source_sha256, word_count, discovery_grant_id)
      select '${document}', '${p.user}', (select id from public.institutional_courses where course_code = 'ACC101'),
        '${p.user}/${document}', 'n.txt', 'text/plain', 10, now() + interval '1 day', 'ready', 'ready text',
        encode(sha256(convert_to('ready text', 'UTF8')), 'hex'), 2,
        (select id from public.entitlement_grants where user_id = '${p.user}')`)
    // Each racer starts and immediately fails its attempt, as a provider outage would.
    const attempt = () => asService(`(with begun as (select public.begin_ai_practice_generation('${p.session}',
        gen_random_uuid(), '${document}', array['trial']) as r)
      select coalesce((select (public.finish_ai_practice_generation('${p.user}', (r ->> 'generation_id')::uuid, 'failed',
        'timeout', null, null) ->> 'state') from begun where r ->> 'state' = 'started'), (select r ->> 'state' from begun)))`)
    const lock = `ai-practice-generation:${p.user}`
    const racers = Array.from({ length: CONCURRENCY }, attempt)
    const marker = `discovery-test-holder-${randomUUID()}`
    const holder = background(`/* ${marker} */ begin; select pg_advisory_xact_lock(hashtextextended('${lock}', 0));
      select pg_sleep(300); commit;`).catch(() => undefined)
    await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
      and query like '%${marker}%'`) !== '0', 'the generation lock holder')
    const running = racers.map(statement => background(statement))
    await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
      and query like '%begin_ai_practice_generation%' and query not like '%pg_stat_activity%'`)) >= CONCURRENCY,
    'every admission to queue')
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
    await holder
    const states = await Promise.all(running)
    assert.equal(states.filter(state => state === 'finished').length, 3, states.join(','))
    assert.equal(states.filter(state => state === 'allowance-exhausted').length, CONCURRENCY - 3)
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id = '${p.user}'`), '3',
      'exactly three provider attempts were ever admitted')
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id = '${p.user}' and state = 'consumed'`), '0',
      'failures never spend the one set')
  } finally { cleanup([p.user]) }
})

test('expiry follows the database wall clock across separate requests and sessions', { skip: !enabled }, async () => {
  const p = student()
  try {
    sql(`update public.entitlement_grants set ends_at = clock_timestamp() + interval '1500 milliseconds'
      where user_id = '${p.user}'`)
    const topic = sql(`select id from public.managed_content_items where course_id = '${COURSES[3]}' and kind = 'note'
      and published_revision is not null limit 1`)
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${COURSES[3]}', 'study_guide', true, '${topic}')
      ->> 'state'`)), 'ready', 'served while the pass is open')
    await new Promise(resolve => setTimeout(resolve, 2000))
    const fresh = randomUUID()
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${fresh}', '${p.user}', now(), now())`)
    for (const session of [p.session, fresh]) {
      assert.equal(sql(asService(`public.discovery_preview('${session}', '${COURSES[3]}', 'study_guide', false) ->> 'state'`)),
        'expired', 'closed for the old session and a brand-new one alike')
    }
  } finally { cleanup([p.user]) }
})
