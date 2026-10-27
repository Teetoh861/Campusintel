// lib/quiz-attempts/server-run-practice.database.test.cjs — Real concurrent sessions against a LOCAL database for
// server-run practice: racing starts give one attempt, racing submissions and the overdue sweep grade once, two tabs
// saving different questions at once lose nothing, saves racing the deadline are each either counted whole or
// refused (so the grade is always the sheet saved in time), a plan ending while a start waits starts nothing, and a
// lost submission response is recovered by a reload.
// Needs 20261025100000_server_run_practice.sql. Opt in: PRACTICE_DB_TEST=1 [PRACTICE_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.PRACTICE_DB_TEST === '1'
const container = process.env.PRACTICE_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// A free course (use-of-english, 100 valid questions) and a department course (financial-accounting-1, 150).
const FREE_COURSE = '40000000-0000-4000-8000-000000000008'
const PLAN_COURSE = '40000000-0000-4000-8000-000000000007'
const SECONDS = 1800

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

/** Hold the per-student lock every practice request takes, so all racers provably queue before any runs. */
async function holdStudent(userId, racers) {
  const marker = `practice-test-holder-${randomUUID()}`
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

/** One confirmed student with a live session and a full plan. */
function student() {
  const user = randomUUID()
  const session = randomUUID()
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
      'practice-${user}@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());
    insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
      values ('${user}', 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'practice-db-test');`)
  return { user, session }
}

const cleanup = users => sql(`delete from auth.users where id in (${users.map(id => `'${id}'`).join(',')})`)
const tabN = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
const startCall = (p, attempt, course, expected = 50) =>
  `public.practice_start('${p.session}', '${attempt}', '${course}', 'new', null, 50, ${SECONDS}, '[]', ${expected}, ${SECONDS}, false)`
const saveCall = (p, attempt, { tab, sequence, base, changes }) =>
  `public.practice_save('${p.session}', '${attempt}', '${tab}', ${sequence}, ${base}, '${JSON.stringify(changes)}')`
const submitCall = (p, attempt, { tab, sequence, base, changes }) =>
  `public.practice_submit('${p.session}', '${attempt}', '${tab}', ${sequence}, ${base}, '${JSON.stringify(changes)}')`

/** Start one attempt and return its pinned questions with their key, read as the owner. */
function begin(p, course = FREE_COURSE) {
  const attempt = randomUUID()
  assert.equal(sql(asService(`${startCall(p, attempt, course)} ->> 'state'`)), 'ready')
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
    'saved', saved_answers, 'revision', saved_revision, 'finished', finished_at, 'deadline', deadline_at,
    'rows', (select count(*) from public.quiz_attempt_answers where attempt_id = a.id),
    'right', (select count(*) from public.quiz_attempt_answers where attempt_id = a.id and is_correct))
  from public.quiz_attempts a where id = '${attempt}'`))

test('racing starts with different ids open exactly one attempt per course', { skip: !enabled }, async () => {
  const p = student()
  try {
    const ids = Array.from({ length: CONCURRENCY }, () => randomUUID())
    const results = (await holdStudent(p.user, ids.map(id => asService(`${startCall(p, id, PLAN_COURSE)}::text`))))
      .map(text => JSON.parse(text))
    const opened = new Set(results.map(result => result.attempt.id))
    assert.equal(opened.size, 1, 'every caller is given the same attempt')
    assert.equal(results.filter(result => result.state === 'ready').length, 1)
    assert.equal(results.filter(result => result.state === 'in-progress').length, CONCURRENCY - 1)
    assert.equal(sql(`select count(*) from public.quiz_attempts where user_id = '${p.user}'`), '1')
    assert.equal(sql(`select count(*) from public.quiz_attempt_questions q join public.quiz_attempts a on a.id = q.attempt_id
      where a.user_id = '${p.user}'`), '50', 'one set of questions is pinned')
  } finally { cleanup([p.user]) }
})

test('racing starts without a held lock still open one attempt, and replays of one id agree', { skip: !enabled }, async () => {
  const p = student()
  try {
    const ids = Array.from({ length: CONCURRENCY }, () => randomUUID())
    await Promise.all(ids.map(id => background(asService(`${startCall(p, id, FREE_COURSE)} ->> 'state'`))))
    assert.equal(sql(`select count(*) from public.quiz_attempts where user_id = '${p.user}'`), '1')
    const replay = randomUUID()
    const other = student()
    try {
      const answers = await Promise.all(Array.from({ length: CONCURRENCY },
        () => background(asService(`${startCall(other, replay, PLAN_COURSE)} -> 'attempt' -> 'questions'`))))
      assert.equal(new Set(answers).size, 1, 'a replayed start returns the same questions every time')
      assert.equal(sql(`select count(*) from public.quiz_attempts where user_id = '${other.user}'`), '1')
    } finally { cleanup([other.user]) }
  } finally { cleanup([p.user]) }
})

test('racing submissions with different pending answers grade once and agree', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p)
    // Racer i would have its first i questions right, so each racer's own grading would differ.
    const scores = await holdStudent(p.user, Array.from({ length: CONCURRENCY }, (_, i) => asService(`${submitCall(p,
      attempt, { tab: tabN(i), sequence: 1, base: 0, changes: Object.fromEntries(keys.slice(0, CONCURRENCY).map(
        (key, index) => [key.question, index < i ? key.right : key.wrong])) })} -> 'attempt' -> 'result' ->> 'score'`)))
    assert.equal(new Set(scores).size, 1, `every caller sees the one grading: ${scores.join(',')}`)
    const row = attemptRow(attempt)
    assert.equal(row.status, 'submitted')
    assert.equal(String(row.score), scores[0])
    assert.equal(row.rows, CONCURRENCY, 'one marked row per answered question, never two gradings')
    assert.equal(row.right, row.score)
  } finally { cleanup([p.user]) }
})

test('submissions racing the overdue sweep across the deadline grade once, from the sheet saved in time',
  { skip: !enabled }, async () => {
    const students = Array.from({ length: 4 }, () => student())
    try {
      for (const [round, p] of students.entries()) {
        const { attempt, keys } = begin(p)
        const saved = { [keys[0].question]: keys[0].right, [keys[1].question]: keys[1].right }
        assert.equal(sql(asService(`${saveCall(p, attempt, { tab: tabN(0), sequence: 1, base: 0, changes: saved })}
          ->> 'state'`)), 'saved')
        // The deadline falls while submissions (each adding a right answer) and sweeps are in flight.
        sql(`update public.quiz_attempts set created_at = created_at - interval '1 hour',
          deadline_at = clock_timestamp() + interval '${150 + round * 50} milliseconds' where id = '${attempt}'`)
        const racers = []
        for (let i = 0; i < CONCURRENCY; i += 1) {
          racers.push(background(asService(`${submitCall(p, attempt, { tab: tabN(i + 1), sequence: 1, base: 1,
            changes: { [keys[2 + i].question]: keys[2 + i].right } })}::text`)))
          racers.push(background(strict('select private.close_overdue_practice_all()')))
          await new Promise(resolve => setTimeout(resolve, 40))
        }
        const answers = (await Promise.all(racers)).filter(text => text.startsWith('{')).map(text => JSON.parse(text))
        const row = attemptRow(attempt)
        assert.notEqual(row.status, 'in_progress', 'the attempt is graded')
        assert.equal(new Set(answers.map(answer => JSON.stringify(answer.attempt.result))).size, 1,
          'every submission returns the one grading')
        assert.equal(row.rows, Object.keys(row.saved).length, 'marked rows are exactly the graded sheet')
        assert.equal(row.right, row.score, 'the score is the marked rows')
        if (row.status === 'timed_out') {
          assert.equal(row.finished, row.deadline, 'closed as of the deadline')
          assert.equal(row.score, Object.keys(row.saved).length, 'graded from the sheet saved in time only')
        } else {
          assert.ok(new Date(row.finished) <= new Date(row.deadline), 'submitted before the deadline')
          assert.equal(row.score, 3, 'the two saved answers and the one submission that won')
        }
      }
    } finally { cleanup(students.map(p => p.user)) }
  })

test('saves racing the deadline are each counted whole or refused, never half-applied', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p)
    sql(`update public.quiz_attempts set created_at = created_at - interval '1 hour' where id = '${attempt}'`)
    // Three tabs, each saving pairs of right answers in its own sequence. Once every tab has had three saves
    // acknowledged, the deadline is brought to 150 ms away, so it falls while the remaining saves are in flight.
    const TABS = 3
    let warmed = 0
    let release = () => {}
    const deadlineSet = new Promise(resolve => { release = resolve })
    const tabs = Array.from({ length: TABS }, (_, tab) => (async () => {
      const outcomes = []
      for (let sequence = 1; sequence <= 8; sequence += 1) {
        const first = keys[tab * 16 + sequence * 2 - 2]
        const second = keys[tab * 16 + sequence * 2 - 1]
        const text = await background(asService(`${saveCall(p, attempt, { tab: tabN(tab), sequence, base: 0,
          changes: { [first.question]: first.right, [second.question]: second.right } })}::text`))
        outcomes.push({ ...JSON.parse(text), pair: [first.question, second.question] })
        if (sequence === 3) {
          warmed += 1
          if (warmed === TABS) {
            sql(`update public.quiz_attempts set deadline_at = clock_timestamp() + interval '150 milliseconds'
              where id = '${attempt}'`)
            release()
          }
          await deadlineSet
        }
      }
      return outcomes
    })())
    const outcomes = (await Promise.all(tabs)).flat()
    await until(() => attemptRow(attempt).status !== 'in_progress' ||
      JSON.parse(sql(asService(`public.practice_attempt('${p.session}', '${attempt}')::text`))).state === 'graded',
    'the attempt to close', 5_000)
    const row = attemptRow(attempt)
    assert.equal(row.status, 'timed_out')
    const saved = row.saved ?? {}
    for (const outcome of outcomes) {
      const present = outcome.pair.filter(question => question in saved).length
      assert.ok(present === 0 || present === 2, 'a pair is in the sheet whole or not at all')
      if (outcome.state === 'saved') assert.equal(present, 2, 'every acknowledged save is in the graded sheet')
      else assert.equal(outcome.state, 'graded', `a refused save is answered with the grade: ${outcome.state}`)
    }
    assert.ok(outcomes.some(outcome => outcome.state === 'saved') && outcomes.some(outcome => outcome.state === 'graded'),
      'the deadline fell inside the run')
    assert.equal(row.score, Object.keys(saved).length, 'graded from exactly the sheet saved in time')
    assert.equal(row.rows, Object.keys(saved).length)
  } finally { cleanup([p.user]) }
})

test('two tabs saving different questions at once lose nothing', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p)
    await holdStudent(p.user, Array.from({ length: CONCURRENCY }, (_, i) => asService(`${saveCall(p, attempt, {
      tab: tabN(i), sequence: 1, base: 0, changes: { [keys[i].question]: keys[i].wrong } })} ->> 'state'`)))
    const row = attemptRow(attempt)
    assert.equal(Object.keys(row.saved).length, CONCURRENCY, 'every tab\'s answer is in the sheet')
    assert.equal(row.revision, CONCURRENCY)
    assert.equal(row.rows, 0, 'and nothing is marked while the attempt is open')
  } finally { cleanup([p.user]) }
})

test('a plan that ends while a start waits on the student lock starts nothing', { skip: !enabled }, async () => {
  const p = student()
  try {
    sql(`update public.entitlement_grants set ends_at = clock_timestamp() + interval '10 minutes' where user_id = '${p.user}'`)
    const marker = `practice-test-holder-${randomUUID()}`
    const holder = background(`/* ${marker} */ begin;
      select pg_advisory_xact_lock(hashtextextended('practice-account:${p.user}', 0)); select pg_sleep(300); commit;`)
      .catch(() => undefined)
    await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
      and query like '%${marker}%'`) !== '0', 'the practice lock holder')
    // The start's transaction begins while the plan is still active, then waits for the lock.
    const attempt = randomUUID()
    const start = background(asService(`${startCall(p, attempt, PLAN_COURSE)}::text`))
    await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
      and query like '%practice_start%' and query not like '%pg_stat_activity%'`)) >= 1, 'the start to queue')
    sql(`update public.entitlement_grants set ends_at = clock_timestamp() + interval '100 milliseconds' where user_id = '${p.user}'`)
    await new Promise(resolve => setTimeout(resolve, 300))
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
    await holder
    assert.equal(JSON.parse(await start).state, 'locked', 'judged at the moment it ran, after the plan ended')
    assert.equal(sql(`select count(*) from public.quiz_attempts where user_id = '${p.user}'`), '0', 'no new attempt')
  } finally { cleanup([p.user]) }
})

test('a submission whose response is lost is found again by a reload, graded once', { skip: !enabled }, async () => {
  const p = student()
  try {
    const { attempt, keys } = begin(p, PLAN_COURSE)
    const changes = Object.fromEntries(keys.slice(0, 12).map((key, index) => [key.question, index < 7 ? key.right : key.wrong]))
    // The client never reads this response (the network dropped it).
    await background(asService(`${submitCall(p, attempt, { tab: tabN(0), sequence: 1, base: 0, changes })} ->> 'state'`))
    const states = await Promise.all(Array.from({ length: 3 }, () =>
      background(asService(`public.practice_state('${p.session}', '${PLAN_COURSE}')::text`))))
    for (const text of states) {
      const state = JSON.parse(text)
      assert.equal(state.state, 'graded')
      assert.equal(state.attempt.id, attempt, 'the reload finds the submitted attempt')
      assert.equal(state.attempt.score, 7)
    }
    const review = JSON.parse(sql(asService(`public.practice_attempt('${p.session}', '${attempt}')::text`)))
    assert.equal(review.attempt.result.score, 7)
    assert.equal(attemptRow(attempt).rows, 12, 'graded once')
  } finally { cleanup([p.user]) }
})
