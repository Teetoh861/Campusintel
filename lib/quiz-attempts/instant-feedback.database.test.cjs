// lib/quiz-attempts/instant-feedback.database.test.cjs — Real concurrent sessions against a LOCAL database for instant
// feedback practice: a double tap or two tabs sending the same pick record it once and all get the same result; racing
// different picks on one question keep the first and return it to the rest; replayed starts return the same attempt;
// a lost response is answered again unchanged; the sweep racing picks on an overdue attempt neither fails nor counts a
// late pick; two tabs switching topics end with one open run; racing exam starts over a topic run start one exam and
// close the run once; a topic run whose deadline passes while a start waits on the content locks times out at its
// deadline and the start goes ahead; a session or plan that ends while a start waits on any of its locks starts nothing,
// and the installed practice_start takes no lock after its final checks and none the lock matrix misses; an open exam
// blocks practice starts.
// Needs 20261029120000_instant_feedback_practice.sql and 20261029150000_practice_by_topic.sql. Opt in:
//   PRACTICE_DB_TEST=1 PRACTICE_DB_CONTAINER=supabase_db_<isolated project>
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
// Real sessions on the paid course, and bounded lock holders that prove a request is queued.
const review = require('./practice-review-fixture.cjs')

const enabled = process.env.PRACTICE_DB_TEST === '1'
const container = process.env.PRACTICE_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_'), 'set PRACTICE_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// Include Docker startup and queue observation, while staying within the holder's 20-second bound.
const PLAN_EXPIRY_WINDOW_SECONDS = 10
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
// financial-accounting-1 (paid): a topic of its bank.
const PLAN_TOPIC = 'Bookkeeping & Errors'
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

test('two tabs starting different topics end with one open run; the run they replace keeps its picks and score',
  { skip: !enabled }, async () => {
    const p = student()
    try {
      const { attempt: first, keys } = begin(p)
      for (const [n, key] of keys.slice(0, 3).entries()) {
        sql(asService(`${pickCall(p, first, key.question, n < 2 ? key.right : key.wrong)} ->> 'state'`))
      }
      const tabs = ['The Sounds of English', 'Comprehension & Summary'].map(topic => ({ topic, attempt: randomUUID() }))
      const results = await holdStudent(p.user,
        tabs.map(tab => asService(`${startCall(p, tab.attempt, tab.topic)} ->> 'state'`)))
      assert.deepEqual(results, ['ready', 'ready'], 'each tab gets a run; neither request fails')
      const runs = JSON.parse(sql(`select jsonb_object_agg(id, jsonb_build_object('status', status, 'topic', topic))
        from public.quiz_attempts where user_id = '${p.user}'`))
      const open = Object.entries(runs).filter(([, run]) => run.status === 'in_progress')
      assert.equal(open.length, 1, 'one open run for the course')
      assert.ok(tabs.some(tab => tab.attempt === open[0][0] && tab.topic === open[0][1].topic), 'one of the two topics')
      assert.deepEqual(attemptRow(first), { status: 'submitted', score: 2, revision: 3, rows: 3, right: 2 },
        'the replaced run keeps its three picks and its score')
      assert.equal(Object.keys(runs).length, 3, 'nothing else started')
    } finally { cleanup([p.user]) }
  })

test('a double tap and a second tab starting the exam over an open topic run: one exam, the run closed once',
  { skip: !enabled }, async () => {
    const p = student()
    try {
      const { attempt: run, keys } = begin(p)
      for (const [n, key] of keys.slice(0, 3).entries()) {
        sql(asService(`${pickCall(p, run, key.question, n < 2 ? key.right : key.wrong)} ->> 'state'`))
      }
      const examCall = attempt => `public.practice_start('${p.session}', '${attempt}', '${COURSE}', 'new', null, 50, 1800,
        '[]', 50, 1800, false)`
      // Two taps on one tab send the same attempt id; the second tab sends its own.
      const [tab1, tab2] = [randomUUID(), randomUUID()]
      const results = (await holdStudent(p.user, [tab1, tab1, tab2, tab2].map(id => asService(`${examCall(id)}::text`))))
        .map(withoutClock)
      const exams = sql(`select string_agg(id::text, ',') from public.quiz_attempts where user_id = '${p.user}' and mode = 'exam'`)
      assert.equal(exams.split(',').length, 1, 'one exam')
      assert.ok([tab1, tab2].includes(exams), 'started by one of the two tabs')
      assert.ok(results.every(result => ['ready', 'in-progress'].includes(result.state) && result.attempt.id === exams
        && result.attempt.mode === 'exam'), 'every request is handed that exam')
      assert.equal(results.filter(result => /correct_option|explanation/.test(JSON.stringify(result))).length, 0,
        'the open exam reveals nothing')
      assert.deepEqual(attemptRow(run), { status: 'submitted', score: 2, revision: 3, rows: 3, right: 2 },
        'the topic run closed once, keeping its three picks and its score')
      assert.equal(sql(`select string_agg(mode || ':' || status, ',' order by mode) from public.quiz_attempts
        where user_id = '${p.user}'`), 'exam:in_progress,instant:submitted', 'one open attempt: the exam')
      // A replay after the race returns the same exam, and the closed run stays as it was.
      assert.equal(JSON.parse(sql(asService(`${examCall(exams)}::text`))).attempt.id, exams)
      assert.deepEqual(attemptRow(run), { status: 'submitted', score: 2, revision: 3, rows: 3, right: 2 })
    } finally { cleanup([p.user]) }
  })

/** Hold the course's CBT items as a publish would, so a start provably waits on its content locks while `during` runs. */
async function holdContent(start, during) {
  const marker = `instant-test-content-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; select 1 from public.managed_content_items
    where course_id = '${COURSE}' and kind = 'cbt_question' for update; select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the content lock holder')
  const running = background(start)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%practice_start%' and query not like '%pg_stat_activity%'`) !== '0', 'the start to wait on the content')
  await during()
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`)
  await holder
  return running
}

test('a topic run whose deadline passes while an exam start or a topic switch waits on the content locks times out at its deadline; the start goes ahead',
  { skip: !enabled }, async () => {
    const examCall = (p, attempt) => `public.practice_start('${p.session}', '${attempt}', '${COURSE}', 'new', null, 50, 1800,
      '[]', 50, 1800, false)`
    const cases = [
      { label: 'exam start', call: examCall, mode: 'exam', closed: 'timed_out' },
      { label: 'topic switch', call: (p, attempt) => startCall(p, attempt, 'The Sounds of English'), mode: 'instant',
        closed: 'timed_out' },
      // The sweep can close the run first while the start waits: the start leaves it as the sweep closed it.
      { label: 'exam start after the sweep', call: examCall, mode: 'exam', closed: 'timed_out', sweep: true },
    ]
    for (const c of cases) {
      const p = student()
      try {
        const { attempt: run, keys } = begin(p)
        for (const [n, key] of keys.slice(0, 2).entries()) {
          sql(asService(`${pickCall(p, run, key.question, n === 0 ? key.right : key.wrong)} ->> 'state'`))
        }
        const next = randomUUID()
        const result = JSON.parse(await holdContent(asService(`${c.call(p, next)}::text`), async () => {
          sql(`update public.quiz_attempts set deadline_at = clock_timestamp() + interval '200 milliseconds'
            where id = '${run}'`)
          await until(() => sql(`select clock_timestamp() > deadline_at from public.quiz_attempts
            where id = '${run}'`) === 't', 'the topic run to pass its deadline')
          if (c.sweep) assert.equal(sql('select private.close_overdue_practice_all() > 0'), 't', 'the sweep closes the run')
        }))
        assert.equal(result.state, 'ready', `${c.label}: the start goes ahead`)
        assert.equal(result.attempt.id, next)
        assert.equal(result.attempt.mode, c.mode)
        assert.deepEqual(attemptRow(run), { status: c.closed, score: 1, revision: 2, rows: 2, right: 1 },
          `${c.label}: the old run keeps its two picks and their score`)
        assert.equal(sql(`select finished_at = deadline_at from public.quiz_attempts where id = '${run}'`), 't',
          `${c.label}: closed at its deadline`)
        assert.equal(sql(`select string_agg(id::text, ',') from public.quiz_attempts where user_id = '${p.user}'
          and status = 'in_progress'`), next, `${c.label}: one open attempt, the new one`)
      } finally { cleanup([p.user]) }
    }
  })

// Every lock an exam start over an open topic run takes, in order. The start is judged only after the last of them.
const START_LOCKS = [
  ['the Auth user', p => `select 1 from auth.users where id = '${p.user}' for update`],
  ['the entitlement account', p => `select pg_advisory_xact_lock(hashtextextended('entitlement-account:${p.user}', 0))`],
  ['the profile', p => `select 1 from public.profiles where id = '${p.user}' for update`],
  ['the academic calendar', () => `select pg_advisory_xact_lock(hashtextextended('academic-calendar', 0))`],
  ['the practice account', p => `select pg_advisory_xact_lock(hashtextextended('practice-account:${p.user}', 0))`],
  ['a grant to bind', p => `select 1 from public.entitlement_grants where user_id = '${p.user}' for update`],
  ['an overdue attempt', (p, ctx) => `select 1 from public.quiz_attempts where id = '${ctx.overdue}' for update`],
  ['the course questions', () => `select 1 from public.managed_content_items where course_id = '${review.PLAN}'
    and kind = 'cbt_question' for update`],
  ['the topic run it replaces', (p, ctx) => `select 1 from public.quiz_attempts where id = '${ctx.run}' for update`],
]

test('a session or plan that ends while an exam start waits on any of its locks starts nothing; otherwise the full timer',
  { skip: !enabled }, async () => {
    for (const [lock, holdSql] of START_LOCKS) {
      for (const change of ['session', 'plan', 'none']) {
        const label = `${lock}, ${change === 'none' ? 'nothing changes' : `the ${change} ends`}`
        const p = review.student()
        try {
          // A topic run on the paid course with one pick; the exam start below would replace it.
          const run = randomUUID()
          assert.equal(review.service(startCall(p, run, PLAN_TOPIC).replace(COURSE, review.PLAN)).state, 'ready')
          const [question, right] = Object.entries(review.answer(run))[0]
          assert.equal(review.service(pickCall(p, run, question, right)).state, 'picked')
          const ctx = { run }
          if (lock === 'a grant to bind') review.sql(`update public.entitlement_grants set course_term_id = null where user_id = '${p.user}'`)
          if (lock === 'an overdue attempt') {
            ctx.overdue = review.begin(p)
            review.sql(`update public.quiz_attempts set created_at = clock_timestamp() - interval '4 hours',
              deadline_at = clock_timestamp() - interval '1 hour' where id = '${ctx.overdue}'`)
          }
          // Prove it is live once queued, then wait for actual expiry before releasing the held lock.
          if (change === 'plan') review.sql(`update public.entitlement_grants set ends_at = clock_timestamp() + make_interval(secs => ${PLAN_EXPIRY_WINDOW_SECONDS})
            where user_id = '${p.user}'`)
          const next = randomUUID()
          const result = await review.queued(review.start(p, next, review.PLAN, false), holdSql(p, ctx), async () => {
            if (change === 'session') {
              review.sql(`update auth.sessions set not_after = clock_timestamp() where id = '${p.session}'`)
            } else if (change === 'plan') {
              assert.equal(review.sql(`select bool_and(ends_at > clock_timestamp()) from public.entitlement_grants
                where user_id = '${p.user}'`), 't', `${label}: the plan is live when the start queues`)
              await review.until(() => review.sql(`select bool_and(ends_at <= clock_timestamp()) from public.entitlement_grants
                where user_id = '${p.user}'`) === 't', 'the plan to end')
            } else await new Promise(resolve => setTimeout(resolve, 1200))
          })
          if (change === 'none') {
            assert.equal(result.state, 'ready', `${label}: the start goes ahead`)
            const left = (Date.parse(result.attempt.deadline_at) - Date.parse(result.now)) / 1000
            assert.ok(left > 1799.5, `${label}: the full 30 minutes from when it started (${left} s)`)
            assert.equal(attemptRow(run).status, 'submitted', `${label}: the topic run closed`)
          } else {
            assert.deepEqual(result, { state: change === 'session' ? 'signed-out' : 'locked' }, `${label}: refused`)
            assert.equal(review.sql(`select count(*) from public.quiz_attempts where id = '${next}'`), '0', `${label}: nothing started`)
            assert.deepEqual(attemptRow(run), { status: 'in_progress', score: null, revision: 1, rows: 1, right: 1 },
              `${label}: the topic run is left as it was`)
          }
        } finally { review.cleanup(p) }
      }
    }
  })

// What can wait in plpgsql: a row lock, an advisory lock, a table lock, or a call to a function that takes locks.
const WAITS = [/\bfor\s+(?:no\s+key\s+update|key\s+share|update|share)\b/i, /\bpg_advisory\w*/i, /\block\s+table\b/i,
  /\b(?:lock_course_access_scope|bind_pending_course_grants|close_overdue_practice|open_course_access_read)\b/i,
  /\bprivate\.\w*lock\w*/i]
// Each lock practice_start (and the scope lock it calls) takes, and the START_LOCKS classes that hold it in the matrix.
const LOCK_CLASSES = [
  [/^perform\s+private\.lock_course_access_scope\(v_user\)$/i, []],
  [/^perform\s+1\s+from\s+auth\.users\s+where\s+id\s*=\s*p_user\s+for\s+share$/i, ['the Auth user']],
  [/hashtextextended\('entitlement-account:'/i, ['the entitlement account']],
  [/^perform\s+1\s+from\s+public\.profiles\s+where\s+id\s*=\s*p_user\s+for\s+share$/i, ['the profile']],
  [/hashtextextended\('academic-calendar'/i, ['the academic calendar']],
  [/hashtextextended\('practice-account:'/i, ['the practice account']],
  [/^perform\s+private\.bind_pending_course_grants\(v_user\)$/i, ['a grant to bind']],
  [/^perform\s+private\.close_overdue_practice\(v_user\)$/i, ['an overdue attempt']],
  [/^perform\s+1\s+from\s+public\.managed_content_items\s+where\s+course_id\s*=\s*p_course_id\s+and\s+kind\s*=\s*'cbt_question'\s+for\s+share$/i,
    ['the course questions']],
  [/^select\s+\*\s+into\s+v_closing\s+from\s+public\.quiz_attempts\s+where\s+id\s*=\s*v_switch\s+for\s+update$/i,
    ['the topic run it replaces']],
]
const installed = name => review.sql(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname = '${name}'`)
// Statements of a plpgsql body, comments dropped and whitespace collapsed; control keywords split off the statement.
const statements = definition => definition.split('$function$')[1].replace(/--[^\n]*/g, '').split(';')
  .map(text => text.replace(/\s+/g, ' ').trim().replace(/^(?:.*\b(?:then|else|begin|loop)\s+)/i, '')).filter(Boolean)
const waits = text => WAITS.some(pattern => pattern.test(text))

/** What breaks the rule "every lock first, then the clock and the checks, then nothing that waits"; [] when it holds. */
function lockOrderProblems(start, scope) {
  const problems = []
  const body = statements(start)
  const clock = body.findIndex(text => /^v_now\s*:=\s*clock_timestamp\(\)$/i.test(text))
  if (clock === -1 || body.filter(text => /v_now\s*:=/i.test(text)).length !== 1) return ['one v_now := clock_timestamp() expected']
  for (const text of body.slice(clock)) if (waits(text)) problems.push(`can wait after the final checks: ${text}`)
  const covered = new Set()
  for (const text of [...body.slice(0, clock), ...statements(scope)].filter(waits)) {
    const known = LOCK_CLASSES.find(([pattern]) => pattern.test(text))
    if (known === undefined) problems.push(`a lock the matrix does not hold: ${text}`)
    else known[1].forEach(name => covered.add(name))
  }
  const matrix = START_LOCKS.map(([name]) => name)
  for (const name of LOCK_CLASSES.flatMap(([, names]) => names)) {
    if (!matrix.includes(name)) problems.push(`no matrix case for ${name}`)
    if (!covered.has(name)) problems.push(`the matrix holds ${name}, which practice_start no longer takes`)
  }
  return problems
}

test('practice_start takes every lock before its clock and checks, and the lock matrix holds each one', { skip: !enabled }, () => {
  assert.deepEqual(lockOrderProblems(installed('public.practice_start'), installed('private.lock_course_access_scope')), [])
})

test('an open exam blocks every racing practice start and stays as it was', { skip: !enabled }, async () => {
  const p = student()
  try {
    const exam = randomUUID()
    assert.equal(sql(asService(`public.practice_start('${p.session}', '${exam}', '${COURSE}', 'new', null, 50, 1800, '[]',
      50, 1800, false) ->> 'state'`)), 'ready')
    const results = (await holdStudent(p.user, Array.from({ length: CONCURRENCY },
      () => asService(`${startCall(p, randomUUID())}::text`)))).map(withoutClock)
    assert.ok(results.every(result => result.state === 'exam-open' && result.attempt.id === exam), 'exam-open, naming the exam')
    assert.equal(results.filter(result => /correct_option|explanation/.test(JSON.stringify(result))).length, 0,
      'and nothing marked')
    assert.equal(sql(`select string_agg(mode || ':' || status, ',') from public.quiz_attempts where user_id = '${p.user}'`),
      'exam:in_progress', 'no practice run started; the exam is untouched')
  } finally { cleanup([p.user]) }
})
