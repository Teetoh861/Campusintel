// lib/quiz-attempts/instant-feedback.database.test.cjs — Real concurrent sessions against a LOCAL database for instant
// feedback practice: a double tap or two tabs sending the same pick record it once and all get the same result; racing
// different picks on one question keep the first and return it to the rest; replayed starts return the same attempt;
// a lost response is answered again unchanged; the sweep racing picks on an overdue attempt neither fails nor counts a
// late pick.
// Needs 20261029120000_instant_feedback_practice.sql and 20261029150000_practice_by_topic.sql. Opt in:
//   PRACTICE_DB_TEST=1 PRACTICE_DB_CONTAINER=supabase_db_<isolated project>
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.PRACTICE_DB_TEST === '1'
const container = process.env.PRACTICE_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_'), 'set PRACTICE_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// use-of-english: free, 100 valid questions.
const COURSE = '40000000-0000-4000-8000-000000000008'

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

const asService = call => `set statement_timeout = '30s'; set lock_timeout = '30s'; set role service_role; select ${call};`
const until = async (predicate, label, timeoutMs = 10_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** Hold the per-student lock every practice request takes, so all racers provably queue before any runs. */
async function holdStudent(userId, racers) {
  const marker = `instant-test-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin;
    select pg_advisory_xact_lock(hashtextextended('practice-account:${userId}', 0)); select pg_sleep(300); commit;`)
    .catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the practice lock holder')
  const running = racers.map(statement => background(statement))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%practice_%' and query not like '%pg_stat_activity%'`)) >= racers.length, 'every racer to queue')
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
  await holder
  return Promise.all(running)
}

function student() {
  const user = randomUUID()
  const session = randomUUID()
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
      'instant-${user}@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());`)
  return { user, session }
}
const cleanup = users => sql(`delete from auth.users where id in (${users.map(id => `'${id}'`).join(',')})`)

// Practice by topic (20261029150000_practice_by_topic.sql): an instant start names a topic; this one has 20 questions.
const TOPIC = 'Listening Skills'
const startCall = (p, attempt, topic = TOPIC) => `public.practice_start('${p.session}', '${attempt}', '${COURSE}', 'new', null,
  10, 10800, '[]', null, null, null, 'instant', '${topic.replace(/'/g, "''")}')`
const pickCall = (p, attempt, question, option) =>
  `public.practice_pick('${p.session}', '${attempt}', '${question}', ${option})`

/** Start one instant attempt; its questions with a right and a wrong option, read as the owner. */
function begin(p) {
  const attempt = randomUUID()
  assert.equal(sql(asService(`${startCall(p, attempt)} ->> 'state'`)), 'ready')
  const keys = sql(`select string_agg(q.question_id || ':' || (r.payload ->> 'correctOption') || ':' ||
      jsonb_array_length(r.payload -> 'options'), ',' order by q.ordinal) from public.quiz_attempt_questions q
    join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
    where q.attempt_id = '${attempt}'`).split(',').map(row => {
    const [question, correct, options] = row.split(':')
    return { question, right: Number(correct), wrong: (Number(correct) + 1) % Number(options) }
  })
  return { attempt, keys }
}

const attemptRow = attempt => JSON.parse(sql(`select jsonb_build_object('status', status, 'score', score,
    'revision', saved_revision, 'rows', (select count(*) from public.quiz_attempt_answers where attempt_id = a.id),
    'right', (select count(*) from public.quiz_attempt_answers where attempt_id = a.id and is_correct))
  from public.quiz_attempts a where id = '${attempt}'`))
const withoutClock = text => { const value = JSON.parse(text); delete value.now; return value }

test('a double tap or two tabs sending the same pick record it once, and every caller gets the same result',
  { skip: !enabled }, async () => {
    const p = student()
    try {
      const { attempt, keys } = begin(p)
      const results = (await holdStudent(p.user, Array.from({ length: CONCURRENCY },
        () => asService(`${pickCall(p, attempt, keys[0].question, keys[0].wrong)}::text`)))).map(withoutClock)
      assert.equal(results.filter(result => result.state === 'picked').length, CONCURRENCY)
      assert.equal(new Set(results.map(result => JSON.stringify(result))).size, 1, 'one result for every caller')
      assert.deepEqual(results[0].pick, { question_id: keys[0].question, selected: keys[0].wrong,
        correct_option: keys[0].right, is_correct: false, explanation: results[0].pick.explanation })
      assert.deepEqual(attemptRow(attempt), { status: 'in_progress', score: null, revision: 1, rows: 1, right: 0 })
    } finally { cleanup([p.user]) }
  })

test('racing different picks on one question keep the first and return it to the rest', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p)
    const options = Array.from({ length: CONCURRENCY }, (_, n) => n % 2 === 0 ? keys[0].right : keys[0].wrong)
    const results = (await holdStudent(p.user,
      options.map(option => asService(`${pickCall(p, attempt, keys[0].question, option)}::text`)))).map(withoutClock)
    const stored = Number(sql(`select option_index from public.quiz_attempt_answers where attempt_id = '${attempt}'`))
    assert.equal(new Set(results.map(result => JSON.stringify(result.pick))).size, 1, 'everyone sees the stored pick')
    assert.equal(results[0].pick.selected, stored)
    results.forEach((result, n) => assert.equal(result.state, options[n] === stored ? 'picked' : 'answer-locked'))
    assert.deepEqual(attemptRow(attempt), { status: 'in_progress', score: null, revision: 1, rows: 1,
      right: stored === keys[0].right ? 1 : 0 })
  } finally { cleanup([p.user]) }
})

test('replayed starts return the same attempt; a lost pick response is answered again unchanged', { skip: !enabled }, async () => {
  const p = student()
  try {
    const attempt = randomUUID()
    const answers = await Promise.all(Array.from({ length: CONCURRENCY },
      () => background(asService(`(${startCall(p, attempt)} -> 'attempt' -> 'questions')::text`))))
    assert.equal(new Set(answers).size, 1, 'the same questions every time')
    assert.equal(sql(`select count(*) from public.quiz_attempts where user_id = '${p.user}'`), '1')
    const question = sql(`select question_id from public.quiz_attempt_questions where attempt_id = '${attempt}'
      and ordinal = 0`)
    const first = withoutClock(sql(asService(`${pickCall(p, attempt, question, 0)}::text`)))
    const again = withoutClock(sql(asService(`${pickCall(p, attempt, question, 0)}::text`)))
    assert.deepEqual(again, first)
    assert.equal(attemptRow(attempt).rows, 1)
  } finally { cleanup([p.user]) }
})

test('the sweep racing picks on an overdue attempt neither fails nor counts a late pick', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p)
    for (const key of keys.slice(0, 3)) sql(asService(`${pickCall(p, attempt, key.question, key.right)} ->> 'state'`))
    sql(`update public.quiz_attempts set created_at = clock_timestamp() - interval '4 hours',
      deadline_at = clock_timestamp() - interval '1 hour' where id = '${attempt}'`)
    const racers = [`set statement_timeout = '30s'; select private.close_overdue_practice_all();`,
      ...keys.slice(3, 3 + CONCURRENCY - 1).map(key => asService(`${pickCall(p, attempt, key.question, key.right)} ->> 'state'`))]
    const results = await Promise.all(racers.map(statement => background(statement)))
    assert.ok(Number(results[0]) >= 0, 'the sweep completes')
    for (const state of results.slice(1)) assert.equal(state, 'graded', 'a late pick is refused with the closed attempt')
    assert.deepEqual(attemptRow(attempt), { status: 'timed_out', score: 3, revision: 3, rows: 3, right: 3 })
  } finally { cleanup([p.user]) }
})
