// lib/entitlements/discovery.database.test.cjs — Real concurrent sessions against a LOCAL database for the Discovery
// Pass: racing opens on different courses pin exactly one preview, racing submissions grade once, two tabs saving
// different questions at once lose nothing, a stale tab's submission grades the sheet the database holds, racing AI
// admissions respect the attempt limit, racing upload settlements accept one file, the exam deadline and pass expiry
// follow the database's wall clock, the migration's seven-day backfill preserves real legacy grants, and builds from
// before the migration still parse the live summary (72-hour pass, 50-question timed exam).
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
const until = async (predicate, label, timeoutMs = 10_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** Hold the per-account lock every Discovery path takes, so all racers provably queue before any runs. */
async function holdAccount(userId, racers, queueTimeoutMs = 10_000) {
  const key = `entitlement-account:${userId}`
  const marker = `discovery-test-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0));
    select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the account lock holder')
  const running = racers.map(statement => background(statement))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%discovery%' and query not like '%pg_stat_activity%'`)) >= racers.length, 'every racer to queue', queueTimeoutMs)
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

// Browser tabs: each names itself so the database applies its requests in sequence order.
const TAB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tabN = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
/** One tab's delta: its changed questions over the revision it last received, at its sequence. */
const saveCall = (session, course, { tab, sequence, base, changes }) =>
  `public.save_discovery_cbt('${session}', '${course}', '${tab}', ${sequence}, ${base}, '${JSON.stringify(changes)}')`
const submitCall = (session, course, { tab, sequence, base, changes }) =>
  `public.submit_discovery_cbt('${session}', '${course}', '${tab}', ${sequence}, ${base}, '${JSON.stringify(changes)}')`

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
    const scores = await holdAccount(p.user, answers.map((body, i) =>
      asService(`${submitCall(p.session, course, { tab: tabN(i), sequence: 1, base: 0, changes: JSON.parse(body) })}
        -> 'preview' -> 'result' ->> 'score'`)))
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
    assert.equal(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 1, base: 0, changes: JSON.parse(sheet(10)) })}
      ->> 'state'`)), 'saved')
    sql(`update private.discovery_previews set deadline_at = clock_timestamp() + interval '1 second'
      where user_id = '${p.user}'`)
    await new Promise(resolve => setTimeout(resolve, 1600))
    // From a different session, a perfect sheet arrives just after the deadline, inside the replay grace.
    const late = randomUUID()
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${late}', '${p.user}', now(), now())`)
    const graded = JSON.parse(sql(asService(`(${submitCall(late, course, { tab: TAB_B, sequence: 1, base: 1, changes: JSON.parse(sheet(50)) })}
      -> 'preview' -> 'result') - 'answers'`)))
    assert.deepEqual(graded, { score: 10, total: 50, timed_out: true })
    assert.equal(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 2, base: 1, changes: JSON.parse(sheet(50)) })}
      -> 'preview' -> 'result' ->> 'score'`)), '10', 'a late save changes nothing')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${p.user}'
      and event in ('discovery.exam-timed-out', 'discovery.exam-submitted')`), '1', 'the exam was marked once, at the deadline')
  } finally { cleanup([p.user]) }
})

/** The pinned questions of the student's open exam as [item_id, correct_option, option_count]. */
function pinned(user) {
  return sql(`select string_agg(q ->> 'item_id' || ':' || (q ->> 'correct_option') || ':' ||
      jsonb_array_length(q -> 'options'), ',') from private.discovery_previews p, jsonb_array_elements(p.content) q
    where p.user_id = '${user}'`).split(',').map(row => row.split(':'))
}
const sheetOf = (keys, correct) => JSON.stringify(Object.fromEntries(keys.map(([item, key, options], index) =>
  [item, index < correct ? Number(key) : (Number(key) + 1) % Number(options)])))

/**
 * Regression (Codex F6): a request that began before the deadline and waited on the account lock until after it must
 * not save or grade late answers. now() is the transaction's start, so only a wall-clock cutoff refuses it.
 */
for (const [label, call, expect] of [
  ['save', (session, course, sheet) => saveCall(session, course, { tab: TAB_A, sequence: 2, base: 1, changes: JSON.parse(sheet) }),
    { state: 'ready', score: 10, timed_out: true, saved_revision: 1 }],
  ['submission', (session, course, sheet) => submitCall(session, course, { tab: TAB_A, sequence: 2, base: 1, changes: JSON.parse(sheet) }),
    { state: 'ready', score: 10, timed_out: true, saved_revision: 1 }],
]) {
  test(`a ${label} that queued on the account lock across the deadline does not land late answers`, { skip: !enabled }, async () => {
    const p = student()
    try {
      const course = COURSES[0]
      assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)),
        'ready')
      const keys = pinned(p.user)
      assert.equal(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 1, base: 0, changes: JSON.parse(sheetOf(keys, 10)) })}
        ->> 'state'`)), 'saved', 'ten correct answers are saved in time')
      // Another request of this account holds the lock; the deadline is set to pass while the racer waits.
      const key = `entitlement-account:${p.user}`
      const marker = `discovery-test-holder-${randomUUID()}`
      const holder = background(`/* ${marker} */ begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0));
        select pg_sleep(300); commit;`).catch(() => undefined)
      await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
        and query like '%${marker}%'`) !== '0', 'the account lock holder')
      sql(`update private.discovery_previews set deadline_at = clock_timestamp() + interval '1500 milliseconds'
        where user_id = '${p.user}'`)
      // The racer's transaction (and so its now()) begins before the deadline, with a perfect sheet. Its first line
      // records that its transaction-start clock was still before the deadline; its second is the function's answer.
      const racer = background(strict(`select now() < (select deadline_at from private.discovery_previews
          where user_id = '${p.user}') as began_before_deadline;
        set role service_role;
        select jsonb_build_object('state', r ->> 'state', 'score', r -> 'preview' -> 'result' -> 'score',
          'timed_out', r -> 'preview' -> 'result' -> 'timed_out', 'answered_after_deadline',
          (r ->> 'now')::timestamptz > (r -> 'preview' ->> 'deadline_at')::timestamptz)
          from (select ${call(p.session, course, sheetOf(keys, 50))} r) t;`))
      await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
        and query like '%${p.session}%' and query not like '%pg_stat_activity%'`)) >= 1, 'the racer to queue on the lock')
      await new Promise(resolve => setTimeout(resolve, 2_000))
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
      await holder
      const [beganBefore, answered] = (await racer).split('\n')
      assert.equal(beganBefore, 't', 'the racer’s transaction began before the deadline: now() alone would have let it through')
      assert.deepEqual(JSON.parse(answered), { state: expect.state, score: expect.score, timed_out: expect.timed_out,
        answered_after_deadline: true },
      `the ${label} is answered with the exam closed from the sheet saved in time, never with its own late sheet`)
      assert.deepEqual(JSON.parse(sql(`select jsonb_build_object('saved_revision', saved_revision, 'score', score,
        'timed_out', timed_out)::text from private.discovery_previews where user_id = '${p.user}'`)),
      { saved_revision: expect.saved_revision, score: expect.score, timed_out: true }, 'nothing late was written')
      assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${p.user}'
        and event = 'discovery.exam-submitted'`), '0', 'no late submission was ever graded')
    } finally { cleanup([p.user]) }
  })
}

/**
 * Regression (Codex review, unresolved at 2cc9300): two tabs of one exam save different questions in the same
 * instant, both queued on the account lock. Tab A changes Q1; tab B, still holding the sheet from before, changes Q2
 * twice and sends one delta. Whichever lands first, no question is lost, and each tab is answered with the sheet that
 * stands. A third request from tab B that was delayed behind its own newer one is refused as stale.
 */
test('two tabs saving different questions at once lose nothing; a tab\'s delayed older request changes nothing', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)),
      'ready')
    const keys = pinned(p.user)
    const [q1, q2, q3] = keys.map(([item]) => item)
    const opened = JSON.parse(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 1, base: 0,
      changes: { [q1]: 0, [q2]: 0, [q3]: 0 } })} - 'now' - 'deadline_at'`)))
    assert.deepEqual(opened, { state: 'saved', revision: 1, answers: { [q1]: 0, [q2]: 0, [q3]: 0 } }, 'both tabs open at revision 1')
    for (const trial of [1, 2]) {
      // Both tabs base their changes on revision 1 (tab B has not seen anything since). They race under the lock,
      // together with tab B's older request (its previous change to Q2, which its newer request supersedes: a tab's
      // newer request always carries every question its older one did).
      const before = Number(sql(`select saved_revision from private.discovery_previews where user_id = '${p.user}'`))
      const racers = [
        asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: trial + 1, base: before, changes: { [q1]: trial } })} - 'now' - 'deadline_at'`),
        asService(`${saveCall(p.session, course, { tab: TAB_B, sequence: trial * 2, base: 1, changes: { [q2]: trial } })} - 'now' - 'deadline_at'`),
        asService(`${saveCall(p.session, course, { tab: TAB_B, sequence: trial * 2 - 1, base: 1, changes: { [q2]: 3 - trial } })} - 'now' - 'deadline_at'`),
      ]
      const answers = (await holdAccount(p.user, racers)).map(row => JSON.parse(row))
      const sheet = JSON.parse(sql(`select saved_answers::text from private.discovery_previews where user_id = '${p.user}'`))
      assert.deepEqual([sheet[q1], sheet[q2], sheet[q3]], [trial, trial, 0],
        `trial ${trial}: Q1 is tab A's, Q2 is tab B's newer change, Q3 was never touched by either: ${JSON.stringify(sheet)}`)
      const states = answers.map(answer => answer.state).sort()
      assert.ok(states.join(',') === 'saved,saved,saved' || states.join(',') === 'saved,saved,stale',
        `trial ${trial}: both tabs' newest requests are saved; the delayed older one is stale or (landing first) applied then overwritten: ${states}`)
      const final = Number(sql(`select saved_revision from private.discovery_previews where user_id = '${p.user}'`))
      assert.ok(final - before >= 2 && final - before <= 3, `trial ${trial}: one revision per applied request`)
      for (const answer of answers) {
        if (answer.revision === final) assert.deepEqual(answer.answers, sheet, `trial ${trial}: the last answer carries the sheet that stands`)
      }
      // tab B's stale request is at or below its applied sequence: the ledger records only the newest.
      assert.equal(sql(`select saved_sources -> '${TAB_B}' ->> 'seq' from private.discovery_previews where user_id = '${p.user}'`),
        String(trial * 2), `trial ${trial}: tab B's newest sequence is the one recorded`)
    }
  } finally { cleanup([p.user]) }
})

/**
 * Regression (Codex review, unresolved at 2cc9300): tab A holds an older sheet; tab B saves a newer answer; tab A
 * submits without another edit, in the same instant as tab B's save, both queued on the lock. Whichever lands first,
 * the grading includes tab B's answer: the database grades the sheet it holds plus the changes still in time, never
 * a stale copy.
 */
test('a stale tab\'s submission grades the sheet the database holds, with the other tab\'s save', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)),
      'ready')
    const keys = pinned(p.user)
    const [item11, correct11] = keys[10]
    assert.equal(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 1, base: 0, changes: JSON.parse(sheetOf(keys, 10)) })}
      ->> 'revision'`)), '1', 'tab A saved ten correct answers')
    const [graded, saved] = (await holdAccount(p.user, [
      asService(`${submitCall(p.session, course, { tab: TAB_A, sequence: 1, base: 1, changes: {} })} -> 'preview' -> 'result' ->> 'score'`),
      asService(`${saveCall(p.session, course, { tab: TAB_B, sequence: 1, base: 1, changes: { [item11]: Number(correct11) } })} ->> 'state'`),
    ]))
    // Either tab B's save landed first (graded 11) or the submission did (graded 10, and the save was answered with the
    // marked result). Both are honest; the stale copy tab A holds is never what is graded.
    const score = Number(sql(`select score from private.discovery_previews where user_id = '${p.user}'`))
    assert.ok((graded === '11' && saved === 'saved' && score === 11) || (graded === '10' && saved === 'ready' && score === 10),
      `graded ${graded}, save answered ${saved}, stored ${score}`)
    assert.equal(sql(`select (answers = saved_answers)::text from private.discovery_previews where user_id = '${p.user}'`), 'true',
      'what was graded is exactly the saved sheet')
    // The deterministic case: tab B's save lands first, then tab A's stale submission.
    const q = student()
    try {
      assert.equal(sql(asService(`public.discovery_preview('${q.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)), 'ready')
      const qkeys = pinned(q.user)
      assert.equal(sql(asService(`${saveCall(q.session, course, { tab: TAB_A, sequence: 1, base: 0, changes: JSON.parse(sheetOf(qkeys, 10)) })} ->> 'revision'`)), '1')
      assert.equal(sql(asService(`${saveCall(q.session, course, { tab: TAB_B, sequence: 1, base: 1, changes: { [qkeys[10][0]]: Number(qkeys[10][1]) } })} ->> 'revision'`)), '2')
      const result = JSON.parse(sql(asService(`(${submitCall(q.session, course, { tab: TAB_A, sequence: 1, base: 1, changes: {} })} -> 'preview' -> 'result') - 'answers'`)))
      assert.deepEqual(result, { score: 11, total: 50, timed_out: false }, 'tab A submitted its stale sheet: tab B\'s answer is marked')
    } finally { cleanup([q.user]) }
  } finally { cleanup([p.user]) }
})

/**
 * Regression (review of 1620315, finding 4): the tab ledger never evicts a watermark. Tab A's delayed sequence 1,
 * racing under the lock with 64 other identities' first saves, cannot overwrite its applied sequence 2; the 65th
 * identity is refused explicitly, never silently.
 */
test('a tab\'s delayed older request racing with 64 other identities cannot overwrite its newer answer', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)), 'ready')
    const [[q1], [q2]] = pinned(p.user)
    assert.equal(sql(asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 2, base: 0, changes: { [q1]: 1 } })} ->> 'revision'`)), '1',
      'tab A applied sequence 2: Q1 = B')
    const racers = [asService(`${saveCall(p.session, course, { tab: TAB_A, sequence: 1, base: 1, changes: { [q1]: 0 } })} ->> 'state'`),
      ...Array.from({ length: 64 }, (_, i) => asService(`${saveCall(p.session, course, { tab: tabN(i + 2), sequence: 1, base: 1, changes: { [q2]: 2 } })} ->> 'state'`))]
    const states = await holdAccount(p.user, racers, 30_000)
    assert.equal(states[0], 'stale', `tab A's delayed sequence 1 is refused whatever the order: ${states[0]}`)
    const others = states.slice(1)
    assert.equal(others.filter(state => state === 'saved').length, 63, `63 identities fit beside tab A: ${others.join(',')}`)
    assert.equal(others.filter(state => state === 'too-many-tabs').length, 1, 'the 65th identity is refused explicitly, never silently')
    const row = JSON.parse(sql(`select jsonb_build_object('q1', saved_answers -> '${q1}', 'tabs', (select count(*) from jsonb_object_keys(saved_sources)),
      'a_seq', (saved_sources -> '${TAB_A}' ->> 'seq')::integer)::text from private.discovery_previews where user_id = '${p.user}'`))
    assert.deepEqual(row, { q1: 1, tabs: 64, a_seq: 2 }, 'Q1 is still B, the ledger holds 64 watermarks, tab A\'s is sequence 2')
  } finally { cleanup([p.user]) }
})

test('at capacity, new identities with changes are refused while existing identities save concurrently', { skip: !enabled }, async () => {
  const p = student()
  try {
    const course = COURSES[0]
    assert.equal(sql(asService(`public.discovery_preview('${p.session}', '${course}', 'cbt', true, null, 1800) ->> 'state'`)), 'ready')
    const keys = pinned(p.user).map(([item]) => item)
    for (let n = 1; n <= 64; n++) {
      assert.equal(sql(asService(`${saveCall(p.session, course, { tab: tabN(n), sequence: 1, base: n - 1, changes: { [keys[0]]: 1 } })} ->> 'state'`)), 'saved')
    }
    const racers = [...Array.from({ length: 4 }, (_, i) => asService(`${saveCall(p.session, course, { tab: tabN(i + 1), sequence: 2, base: 64, changes: { [keys[i + 1]]: 2 } })} ->> 'state'`)),
      ...Array.from({ length: 4 }, (_, i) => asService(`${saveCall(p.session, course, { tab: tabN(100 + i), sequence: 1, base: 64, changes: { [keys[10 + i]]: 3 } })} ->> 'state'`))]
    const states = await holdAccount(p.user, racers)
    assert.deepEqual(states.slice(0, 4), ['saved', 'saved', 'saved', 'saved'], 'existing identities keep saving')
    assert.deepEqual(states.slice(4), ['too-many-tabs', 'too-many-tabs', 'too-many-tabs', 'too-many-tabs'], 'new identities are refused explicitly')
    const row = JSON.parse(sql(`select jsonb_build_object('revision', saved_revision, 'tabs', (select count(*) from jsonb_object_keys(saved_sources)),
      'refused_written', saved_answers ? '${keys[10]}')::text from private.discovery_previews where user_id = '${p.user}'`))
    assert.deepEqual(row, { revision: 68, tabs: 64, refused_written: false }, 'four more revisions, no new identity, nothing from a refused request')
    assert.equal(sql(asService(`${submitCall(p.session, course, { tab: tabN(200), sequence: 0, base: 68, changes: {} })} -> 'preview' -> 'result' ->> 'total'`)), '50',
      'a submission from a new identity with nothing pending still grades the sheet the database holds')
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
