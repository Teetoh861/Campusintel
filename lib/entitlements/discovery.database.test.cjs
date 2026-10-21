// lib/entitlements/discovery.database.test.cjs — Real concurrent sessions against a LOCAL database for the Discovery
// Pass: racing opens on different courses pin exactly one preview, racing submissions grade once, racing AI admissions
// respect the attempt limit, racing upload settlements accept one file, the exam deadline and pass expiry follow the
// database's wall clock, the migration's seven-day backfill preserves real legacy grants, and builds from before the
// migration still parse the live summary (72-hour pass, 50-question timed exam).
// Needs 20261021100000_discovery_pass.sql. Opt in: ENTITLEMENT_DB_TEST=1 [ENTITLEMENT_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')
const { entitlementSummarySchema } = require('./contract.ts')
const { preDiscoverySummarySchema } = require('./fixtures/pre-discovery-summary.cjs')

const enabled = process.env.ENTITLEMENT_DB_TEST === '1'
const container = process.env.ENTITLEMENT_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// Actively offered repository courses with at least 50 valid published CBT questions; 02 also has notes.
const COURSES = ['02', '03', '04', '14', '01', '15', '11', '12'].map(n => `40000000-0000-4000-8000-0000000000${n}`)
const NOTES_COURSE = COURSES[0]
const MIGRATION = readFileSync('supabase/migrations/20261021100000_discovery_pass.sql', 'utf8')

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
    insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
        created_by)
      select '${user}', 'trial', 'discovery', now(), now() + make_interval(hours => discovery_hours), 'capped',
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
        (select id from public.entitlement_grants where user_id = '${p.user}');
      insert into private.discovery_ai_uploads (document_id, grant_id)
        select '${document}', id from public.entitlement_grants where user_id = '${p.user}'`)
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
    const topic = sql(`select id from public.managed_content_items where course_id = '${NOTES_COURSE}' and kind = 'note'
      and published_revision is not null limit 1`)
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${NOTES_COURSE}', 'study_guide', true,
      '${topic}') ->> 'state'`)), 'ready', 'served while the pass is open')
    await new Promise(resolve => setTimeout(resolve, 2000))
    const fresh = randomUUID()
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${fresh}', '${p.user}', now(), now())`)
    for (const session of [p.session, fresh]) {
      assert.equal(sql(asService(`public.discovery_preview('${session}', '${NOTES_COURSE}', 'study_guide', false)
        ->> 'state'`)),
        'expired', 'closed for the old session and a brand-new one alike')
    }
  } finally { cleanup([p.user]) }
})

test('racing settlements of eight pre-reserved uploads accept exactly one', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = sql(`select id from public.institutional_courses where course_code = 'ACC101'`)
    // Reserved one after the other before any is read, as two tabs or quick retries would: all eight get a slot.
    const documents = Array.from({ length: CONCURRENCY }, () => sql(asService(`public.create_ai_practice_document(
      '${p.session}', '${course}', 'n.txt', 'text/plain', 100, array['trial']) ->> 'document_id'`)))
    assert.equal(documents.filter(id => /^[0-9a-f-]{36}$/.test(id)).length, CONCURRENCY, documents.join(','))
    const claims = documents.map(id => sql(asService(`public.claim_ai_practice_extraction('${p.session}', '${id}')
      ->> 'claim_id'`)))
    const grant = sql(`select id from public.entitlement_grants where user_id = '${p.user}'`)
    const lock = `discovery-ai-uploads:${grant}`
    const marker = `discovery-test-holder-${randomUUID()}`
    const holder = background(`/* ${marker} */ begin; select pg_advisory_xact_lock(hashtextextended('${lock}', 0));
      select pg_sleep(300); commit;`).catch(() => undefined)
    await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
      and query like '%${marker}%'`) !== '0', 'the upload lock holder')
    const running = documents.map((id, index) => background(asService(`public.settle_ai_practice_document(
      '${p.session}', '${id}', '${claims[index]}', null, repeat('word ', 300),
      encode(sha256(convert_to(repeat('word ', 300), 'UTF8')), 'hex'), 300)`)))
    await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
      and query like '%settle_ai_practice_document%' and query not like '%pg_stat_activity%'`)) >= CONCURRENCY,
    'every settlement to queue')
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
    await holder
    const settled = await Promise.all(running)
    assert.equal(settled.filter(answer => answer === 't').length, 1, settled.join(','))
    assert.equal(sql(`select string_agg(status || coalesce(':' || rejection_reason, ''), ',' order by status)
      from public.ai_practice_documents where user_id = '${p.user}'`),
    ['ready', ...Array(CONCURRENCY - 1).fill('rejected:pass-upload-limit')].join(','),
    'one upload is accepted; every other reserved upload is rejected at no cost')
    assert.equal(sql(`select count(*) from private.discovery_ai_uploads where grant_id = '${grant}'`), '1')
  } finally { cleanup([p.user]) }
})

test('nothing is marked after the exam deadline: the sheet saved in time is what counts', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)),
      'ready')
    const keys = sql(`select string_agg(q ->> 'item_id' || ':' || (q ->> 'correct_option') || ':' ||
        jsonb_array_length(q -> 'options'), ',') from private.discovery_previews p, jsonb_array_elements(p.content) q
      where p.user_id = '${p.user}'`).split(',').map(row => row.split(':'))
    const sheet = correct => JSON.stringify(Object.fromEntries(keys.map(([item, key, options], index) =>
      [item, index < correct ? Number(key) : (Number(key) + 1) % Number(options)])))
    assert.equal(sql(asService(`public.save_discovery_cbt('${p.session}', '${course}', '${sheet(10)}') ->> 'state'`)),
      'saved')
    sql(`update private.discovery_previews set deadline_at = clock_timestamp() + interval '1 second'
      where user_id = '${p.user}'`)
    await new Promise(resolve => setTimeout(resolve, 1600))
    // From a different session, a perfect sheet arrives just after the deadline, inside the replay grace.
    const late = randomUUID()
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${late}', '${p.user}', now(), now())`)
    const graded = JSON.parse(sql(asService(`(public.submit_discovery_cbt('${late}', '${course}', '${sheet(50)}')
      -> 'preview' -> 'result') - 'answers'`)))
    assert.deepEqual(graded, { score: 10, total: 50, timed_out: true })
    assert.equal(sql(asService(`public.save_discovery_cbt('${p.session}', '${course}', '${sheet(50)}')
      -> 'preview' -> 'result' ->> 'score'`)), '10', 'a late save changes nothing')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${p.user}'
      and event in ('discovery.exam-timed-out', 'discovery.exam-submitted')`), '1', 'the exam was marked once, at the deadline')
  } finally { cleanup([p.user]) }
})

test('the migration backfill keeps a real seven-day trial exactly as issued', { skip: !enabled }, () => {
  const start = MIGRATION.indexOf('-- discovery-pass:legacy-trial-backfill:start')
  const end = MIGRATION.indexOf('-- discovery-pass:legacy-trial-backfill:end')
  const constraint = /alter table public\.entitlement_grants\s+add constraint entitlement_grants_trial_policy_source_check[^;]+;/
    .exec(MIGRATION)
  assert.ok(start > 0 && end > start && constraint !== null, 'the migration marks its backfill and policy constraint')
  const legacy = student()
  const pass = student()
  try {
    // Recreate the pre-migration row: a seven-day, ten-set trial with no policy, four days into its window. Everything
    // happens in one rolled-back transaction, so the constraint is back before anyone else can see the table.
    const row = sql(`begin;
      set local lock_timeout = '10s';
      alter table public.entitlement_grants drop constraint entitlement_grants_trial_policy_source_check;
      update public.entitlement_grants set trial_policy = null, starts_at = now() - interval '4 days',
        ends_at = now() + interval '3 days', ai_units = 10 where user_id = '${legacy.user}';
      create temporary table before_backfill on commit drop as select * from public.entitlement_grants;
      ${MIGRATION.slice(start, end)}
      ${constraint[0]}
      select jsonb_build_object(
        'legacy', (select jsonb_build_object('policy', g.trial_policy, 'unchanged', g.starts_at = b.starts_at
            and g.ends_at = b.ends_at and g.ai_units = b.ai_units and g.revoked_at is not distinct from b.revoked_at)
          from public.entitlement_grants g join before_backfill b using (id) where g.user_id = '${legacy.user}'),
        'pass', (select trial_policy from public.entitlement_grants where user_id = '${pass.user}'),
        'others_unchanged', not exists (select 1 from public.entitlement_grants g join before_backfill b using (id)
          where g.user_id <> '${legacy.user}' and (g.trial_policy is distinct from b.trial_policy
            or g.ends_at <> b.ends_at or g.ai_units is distinct from b.ai_units)),
        'full_access', private.has_full_access('${legacy.user}'),
        'audited', exists (select 1 from private.entitlement_events where user_id = '${legacy.user}'
          and event = 'trial.seven-day-preserved'));
      rollback;`)
    assert.deepEqual(JSON.parse(row), { legacy: { policy: 'seven-day', unchanged: true }, pass: 'discovery',
      others_unchanged: true, full_access: true, audited: true })
    assert.equal(sql(`select trial_policy from public.entitlement_grants where user_id = '${legacy.user}'`), 'discovery',
      'the replay was rolled back')
  } finally { cleanup([legacy.user, pass.user]) }
})

test('a build from before the migration parses the live summary for a pass and a seven-day trial', { skip: !enabled }, () => {
  const pass = student()
  const legacy = student()
  try {
    sql(`update public.entitlement_grants set trial_policy = 'seven-day', ai_units = 10,
        starts_at = now() - interval '1 day', ends_at = now() + interval '6 days' where user_id = '${legacy.user}'`)
    const summary = ({ user, session }) => JSON.parse(sql(`set role authenticated;
      set request.jwt.claims = '{"sub":"${user}","role":"authenticated","session_id":"${session}"}';
      select public.get_my_entitlement();`))
    for (const [label, account, tier, policy] of [['pass', pass, 'free', 'discovery'],
      ['seven-day trial', legacy, 'full', 'seven-day']]) {
      const live = summary(account)
      const old = preDiscoverySummarySchema.safeParse(live)
      assert.equal(old.success, true, `${label}: ${old.success ? '' : old.error.message}`)
      assert.equal(old.data.tier, tier, `${label}: the older build sees the same tier`)
      const current = entitlementSummarySchema.parse(live)
      assert.deepEqual([current.tier, current.trial.policy], [tier, policy], label)
    }
  } finally { cleanup([pass.user, legacy.user]) }
})
