// lib/practice/practice.test.cjs — The server-run practice boundary: commands carry no question set, key, time, size or
// score; an open attempt can never carry a correct option or explanation; every database answer maps to one explicit
// result; and the request handler takes size, duration and sections from the server's own policy.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { practiceCommandSchema, practiceResultSchema, wholeBankAttempt } = require('./contract.ts')

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const COURSE = '40000000-0000-4000-8000-000000000007'
const TAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
const NOW = '2026-10-24T10:00:00.000Z'
const meta = { id: ATTEMPT, course_id: COURSE, mode: 'exam', intent: 'new', redo_of: null, started_at: NOW,
  deadline_at: '2026-10-24T10:30:00.000Z', duration_seconds: 1800, question_count: 2, bank_size: 150 }
const dbOpen = (extra = {}) => ({ status: 'in_progress', ...meta, saved: { revision: 0, answers: {} }, result: null,
  questions: [0, 1].map(n => ({ question_id: Q(n), prompt: `Prompt ${n}`, options: ['A', 'B', 'C'], section: 'General',
    ...extra })) })
const dbGraded = () => ({ status: 'submitted', ...meta, saved: null,
  result: { score: 1, total: 2, timed_out: false, finished_at: '2026-10-24T10:20:00.000Z' },
  questions: [0, 1].map(n => ({ question_id: Q(n), prompt: `Prompt ${n}`, options: ['A', 'B', 'C'], section: 'General',
    item_id: Q(10 + n), revision: 1, selected: n === 0 ? 1 : null, correct_option: 1, explanation: n === 0 ? 'Because.' : null })) })

const server = () => {
  delete require.cache[require.resolve('./server.ts')]
  return require('./server.ts')
}

test('commands name an attempt, a brief and choices only: a question set, key, time, size or score is refused', () => {
  const start = { action: 'start', courseSlug: 'financial-accounting-1', attemptId: ATTEMPT, intent: 'new', redoOf: null,
    expected: { questionCount: 50, durationSeconds: 1800, wholeBank: false } }
  assert.equal(practiceCommandSchema.safeParse(start).success, true)
  for (const extra of [{ questions: [Q(1)] }, { size: 50 }, { seconds: 1800 }, { deadline: NOW }, { sections: ['A'] },
    { score: 50 }, { now: NOW }]) {
    assert.equal(practiceCommandSchema.safeParse({ ...start, ...extra }).success, false, `refuses ${Object.keys(extra)[0]}`)
  }
  assert.equal(practiceCommandSchema.safeParse({ ...start, intent: 'redo' }).success, false, 'a redo names its attempt')
  assert.equal(practiceCommandSchema.safeParse({ ...start, redoOf: ATTEMPT }).success, false, 'a new attempt names none')
  assert.equal(practiceCommandSchema.safeParse({ ...start, intent: 'redo', redoOf: ATTEMPT }).success, true)
  const delta = { attemptId: ATTEMPT, tab: TAB, sequence: 3, baseRevision: 2, changes: { [Q(1)]: 2 } }
  assert.equal(practiceCommandSchema.safeParse({ action: 'save', ...delta }).success, true)
  assert.equal(practiceCommandSchema.safeParse({ action: 'save', ...delta, changes: {} }).success, false,
    'a save with nothing changed is not a save')
  assert.equal(practiceCommandSchema.safeParse({ action: 'save', ...delta, changes: { [Q(1)]: null } }).success, false,
    'a practice choice is never cleared')
  assert.equal(practiceCommandSchema.safeParse({ action: 'save', ...delta, changes: { [Q(1)]: 8 } }).success, false)
  assert.equal(practiceCommandSchema.safeParse({ action: 'save', ...delta, answers: { [Q(1)]: 2 } }).success, false,
    'a whole sheet is refused: only changed questions cross')
  assert.equal(practiceCommandSchema.safeParse({ action: 'submit', ...delta, sequence: 0, changes: {} }).success, true,
    'a tab with nothing pending submits an empty delta: the database grades the sheet it holds')
  assert.equal(practiceCommandSchema.safeParse({ action: 'submit', ...delta, score: 2 }).success, false)
  assert.equal(practiceCommandSchema.safeParse({ action: 'sync', attemptId: ATTEMPT, tab: TAB }).success, true)
  assert.equal(practiceCommandSchema.safeParse({ action: 'attempt', attemptId: 'not-a-uuid' }).success, false)
})

test('an open attempt maps without any key; a graded one carries the key and the review', () => {
  const { practiceResultFrom } = server()
  const open = practiceResultFrom({ state: 'ready', now: NOW, attempt: dbOpen() })
  assert.equal(open.status, 'ready')
  assert.deepEqual(Object.keys(open.attempt.questions[0]).sort(), ['options', 'prompt', 'questionId', 'section'])
  assert.equal(open.attempt.bankSize, 150)
  assert.doesNotMatch(JSON.stringify(open), /correct|explanation|itemId|selected|score/)
  for (const leak of [{ correct_option: 1 }, { explanation: 'x' }, { item_id: Q(9) }, { selected: 0 }]) {
    assert.deepEqual(practiceResultFrom({ state: 'ready', now: NOW, attempt: dbOpen(leak) }), { status: 'unavailable' },
      `an open attempt carrying ${Object.keys(leak)[0]} fails closed`)
  }
  const graded = practiceResultFrom({ state: 'graded', now: NOW, attempt: dbGraded() })
  assert.equal(graded.status, 'graded')
  assert.deepEqual(graded.attempt.result, { score: 1, total: 2, timedOut: false, finishedAt: '2026-10-24T10:20:00.000Z' })
  assert.deepEqual(graded.attempt.questions[0], { questionId: Q(0), prompt: 'Prompt 0', options: ['A', 'B', 'C'],
    section: 'General', itemId: Q(10), revision: 1, selected: 1, correctOption: 1, explanation: 'Because.' })
  assert.equal(practiceResultSchema.safeParse(graded).success, true)
  assert.equal(wholeBankAttempt(graded.attempt), false)
  assert.equal(wholeBankAttempt({ bankSize: 50, questionCount: 50 }), true, 'D4: a bank no larger than the attempt')
})

test('every database answer maps to one explicit result', () => {
  const { practiceResultFrom, practiceStateFrom } = server()
  assert.deepEqual(practiceResultFrom({ state: 'saved', now: NOW, deadline_at: meta.deadline_at, revision: 3,
    answers: { [Q(0)]: 1 } }), { status: 'saved', now: NOW, deadlineAt: meta.deadline_at, revision: 3, answers: { [Q(0)]: 1 } })
  assert.deepEqual(practiceResultFrom({ state: 'policy-changed', question_count: 40, duration_seconds: 1800, bank_size: 40 }),
    { status: 'policy-changed', questionCount: 40, durationSeconds: 1800, bankSize: 40 })
  for (const state of ['signed-out', 'conflict', 'locked', 'not-found', 'questions-changed', 'unavailable', 'invalid-request']) {
    assert.deepEqual(practiceResultFrom({ state }), { status: state })
  }
  assert.deepEqual(practiceResultFrom({ state: 'invalid-course' }), { status: 'not-found' })
  for (const bad of [null, undefined, {}, { state: 'ready' }, { state: 'mystery' }]) {
    assert.deepEqual(practiceResultFrom(bad), { status: 'unavailable' })
  }
  assert.deepEqual(practiceStateFrom({ state: 'none', now: NOW }), { status: 'none' })
  assert.deepEqual(practiceStateFrom({ state: 'open', now: NOW, attempt: { id: ATTEMPT, mode: 'instant', status: 'in_progress',
    intent: 'new', started_at: NOW, deadline_at: meta.deadline_at, duration_seconds: 1800, question_count: 50, bank_size: 150,
    answered: 12, score: null, finished_at: null } }), { status: 'open', now: NOW, attempt: { id: ATTEMPT, mode: 'instant',
    deadlineAt: meta.deadline_at, questionCount: 50, answered: 12, score: null, bankSize: 150 } })
  assert.deepEqual(practiceStateFrom({ state: 'open', now: NOW }), { status: 'unavailable' })
})

test('the server policy is the course configuration; nothing of it comes from the browser', () => {
  const { practicePolicyFor } = server()
  const policy = practicePolicyFor('financial-accounting-1')
  assert.equal(policy.size, 50)
  assert.equal(policy.seconds, 1800)
  assert.ok(policy.sections.length > 0)
  assert.equal(practicePolicyFor('no-such-course'), null)
})

async function requestFixture(run) {
  const original = Module._load
  const calls = []
  const state = { session: { user: { id: 'student' }, sessionId: 'session-1' }, token: 'good',
    lookup: { status: 'ok', course: { repository: { repositoryCourseId: COURSE,
      route: { slug: 'financial-accounting-1' } } } }, answer: { state: 'ready', now: NOW, attempt: dbOpen() } }
  try {
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true, getSupabaseConfig: () => ({ url: 'x' }),
        getAuthSecretKey: () => 'k' }
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ verified: true }) }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => state.session }
      if (name === '@/lib/auth/account-continuity') return { matchesAccountContinuityToken: token => token === state.token }
      if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async (_client, slug) => {
        calls.push(['lookup', slug]); return state.lookup } }
      return original.call(this, name, ...args)
    }
    const { runPracticeRequest } = server()
    const env = sessionId => ({
      start: async start => { calls.push(['start', sessionId, start]); return state.answer },
      state: async () => ({ state: 'none', now: NOW }),
      attempt: async attemptId => { calls.push(['attempt', sessionId, attemptId]); return state.answer },
      save: async (attemptId, delta) => { calls.push(['save', sessionId, attemptId, delta]); return state.answer },
      submit: async (attemptId, delta) => { calls.push(['submit', sessionId, attemptId, delta]); return state.answer },
      pick: async (attemptId, questionId, option) => {
        calls.push(['pick', sessionId, attemptId, questionId, option]); return state.answer },
    })
    await run({ run: (input, token = state.token) => runPracticeRequest(input, { headers: new Headers() }, token, env),
      calls, state })
  } finally {
    Module._load = original
    delete require.cache[require.resolve('./server.ts')]
  }
}

test('a start is identified by the verified session and runs on the server policy with the student brief', async () => requestFixture(async f => {
  const result = await f.run({ action: 'start', courseSlug: 'financial-accounting-1', attemptId: ATTEMPT.toUpperCase(),
    intent: 'new', redoOf: null, expected: { questionCount: 50, durationSeconds: 1800, wholeBank: false } })
  assert.equal(result.status, 'ready')
  const [, sessionId, start] = f.calls.find(call => call[0] === 'start')
  assert.equal(sessionId, 'session-1', 'identity is the verified session, never a caller user id')
  assert.equal(start.attemptId, ATTEMPT, 'attempt ids are normalised')
  assert.equal(start.courseId, COURSE)
  assert.deepEqual([start.policy.size, start.policy.seconds], [50, 1800])
  assert.deepEqual(start.expected, { questionCount: 50, durationSeconds: 1800, wholeBank: false })
}))

test('sync is an empty delta; save and submit carry only this tab\'s delta; no session, page or command is refused', async () => requestFixture(async f => {
  await f.run({ action: 'sync', attemptId: ATTEMPT, tab: TAB })
  assert.deepEqual(f.calls.at(-1), ['save', 'session-1', ATTEMPT, { tab: TAB, sequence: 0, baseRevision: 0, changes: {} }])
  await f.run({ action: 'submit', attemptId: ATTEMPT, tab: TAB, sequence: 2, baseRevision: 1, changes: { [Q(0)]: 1 } })
  assert.deepEqual(f.calls.at(-1), ['submit', 'session-1', ATTEMPT, { tab: TAB, sequence: 2, baseRevision: 1, changes: { [Q(0)]: 1 } }])
  assert.deepEqual(await f.run({ action: 'attempt', attemptId: ATTEMPT }, 'stale-page'), { status: 'session-changed' })
  assert.deepEqual(await f.run({ action: 'attempt', attemptId: ATTEMPT, extra: true }), { status: 'invalid-request' })
  f.state.session = null
  assert.deepEqual(await f.run({ action: 'attempt', attemptId: ATTEMPT }), { status: 'signed-out' })
  f.state.session = { user: { id: 'student' }, sessionId: 'session-1' }
  f.state.lookup = { status: 'not-found' }
  assert.deepEqual(await f.run({ action: 'start', courseSlug: 'financial-accounting-1', attemptId: ATTEMPT, intent: 'new',
    redoOf: null, expected: { questionCount: 50, durationSeconds: 1800, wholeBank: false } }), { status: 'not-found' })
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 0, 'an unknown course starts nothing')
}))

test('the page reads of state and attempt fail closed', async () => {
  const { readPracticeAttempt, readPracticeState } = server()
  const env = { attempt: async () => { throw new Error('network') }, state: async () => ({ state: 'none', now: NOW }) }
  assert.deepEqual(await readPracticeAttempt('session-1', ATTEMPT, env), { status: 'unavailable' })
  assert.deepEqual(await readPracticeAttempt('session-1', 'not-a-uuid', env), { status: 'not-found' })
  assert.deepEqual(await readPracticeState('session-1', COURSE, env), { status: 'none' })
  assert.deepEqual(await readPracticeState('session-1', COURSE, { state: async () => ({ state: 'weird' }) }), { status: 'unavailable' })
})

test('the confirmed briefing includes whole-bank mode, and omitting it is refused', () => {
  const { practiceCommandSchema } = require('./contract.ts')
  const start = { action: 'start', courseSlug: 'financial-accounting-1', attemptId: ATTEMPT,
    intent: 'new', redoOf: null, expected: { questionCount: 50, durationSeconds: 1800 } }
  assert.equal(practiceCommandSchema.safeParse({ ...start, expected: { ...start.expected, wholeBank: false } }).success, true)
  assert.equal(practiceCommandSchema.safeParse(start).success, false)
})

// Instant feedback (20261029120000_instant_feedback_practice.sql) ----------------------------------------------------
const dbInstant = (picked = {}) => ({ ...dbOpen(), mode: 'instant', duration_seconds: 10800,
  questions: [0, 1].map(n => ({ question_id: Q(n), prompt: `Prompt ${n}`, options: ['A', 'B', 'C'], section: 'General',
    ...picked[n] })) })
const dbPick = { question_id: Q(0), selected: 2, correct_option: 1, is_correct: false, explanation: 'Because.' }

test('instant feedback: a command names only the attempt, the question and the option', () => {
  const pick = { action: 'pick', attemptId: ATTEMPT, questionId: Q(0), option: 2 }
  assert.equal(practiceCommandSchema.safeParse(pick).success, true)
  for (const extra of [{ correct: true }, { isCorrect: true }, { score: 1 }, { now: NOW }]) {
    assert.equal(practiceCommandSchema.safeParse({ ...pick, ...extra }).success, false, `refuses ${Object.keys(extra)[0]}`)
  }
  assert.equal(practiceCommandSchema.safeParse({ ...pick, option: 8 }).success, false)
  const start = { action: 'start-instant', courseSlug: 'use-of-english', attemptId: ATTEMPT }
  assert.equal(practiceCommandSchema.safeParse(start).success, true)
  for (const extra of [{ expected: { questionCount: 10, durationSeconds: 10800, wholeBank: false } }, { size: 10 },
    { intent: 'redo' }]) {
    assert.equal(practiceCommandSchema.safeParse({ ...start, ...extra }).success, false, `refuses ${Object.keys(extra)[0]}`)
  }
})

test('instant feedback: only a picked question carries its key; anything else fails closed', () => {
  const { practiceResultFrom } = server()
  const open = practiceResultFrom({ state: 'ready', now: NOW, attempt: dbInstant() })
  assert.equal(open.attempt.mode, 'instant')
  assert.doesNotMatch(JSON.stringify(open), /correct|explanation|feedback|selected/, 'nothing before a pick')
  const picked = practiceResultFrom({ state: 'ready', now: NOW,
    attempt: dbInstant({ 0: { selected: 2, correct_option: 1, explanation: '  ' } }) })
  assert.deepEqual(picked.attempt.questions[0].feedback, { selected: 2, correctOption: 1, explanation: null },
    'a blank explanation is none: "Why" only appears when there is one')
  assert.equal(picked.attempt.questions[1].feedback, undefined, 'the next question still carries nothing')
  assert.deepEqual(practiceResultFrom({ state: 'ready', now: NOW, attempt: dbInstant({ 0: { correct_option: 1 } }) }),
    { status: 'unavailable' }, 'a correct option without a pick fails closed')
  assert.deepEqual(practiceResultFrom({ state: 'ready', now: NOW,
    attempt: { ...dbInstant({ 0: { selected: 2, correct_option: 1, explanation: null } }), mode: 'exam' } }),
  { status: 'unavailable' }, 'an open exam carrying feedback fails closed')
  const result = practiceResultFrom({ state: 'picked', now: NOW, pick: dbPick,
    attempt: dbInstant({ 0: { selected: 2, correct_option: 1, explanation: 'Because.' } }) })
  assert.equal(result.status, 'picked')
  assert.deepEqual(result.pick, { questionId: Q(0), selected: 2, correctOption: 1, isCorrect: false, explanation: 'Because.' })
  assert.equal(practiceResultSchema.safeParse(result).success, true)
  const locked = practiceResultFrom({ state: 'answer-locked', now: NOW, pick: dbPick,
    attempt: dbInstant({ 0: { selected: 2, correct_option: 1, explanation: 'Because.' } }) })
  assert.equal(locked.status, 'answer-locked')
  assert.deepEqual(practiceResultFrom({ state: 'picked', now: NOW, pick: dbPick, attempt: dbOpen() }),
    { status: 'unavailable' }, 'a pick answer on an exam attempt fails closed')
})

test('instant feedback: a start runs on the server\'s instant policy with no brief; a pick reaches the database as sent',
  async () => requestFixture(async f => {
    const { INSTANT_POLICY } = server()
    assert.deepEqual(INSTANT_POLICY, { size: 10, seconds: 10800 })
    f.state.answer = { state: 'ready', now: NOW, attempt: dbInstant() }
    const started = await f.run({ action: 'start-instant', courseSlug: 'financial-accounting-1', attemptId: ATTEMPT })
    assert.equal(started.status, 'ready')
    const [, sessionId, start] = f.calls.find(call => call[0] === 'start')
    assert.equal(sessionId, 'session-1')
    assert.equal(start.mode, 'instant')
    assert.ok(start.sections.length > 0, 'the course\'s own section order')
    assert.equal('expected' in start, false)
    f.state.answer = { state: 'picked', now: NOW, pick: dbPick,
      attempt: dbInstant({ 0: { selected: 2, correct_option: 1, explanation: 'Because.' } }) }
    const picked = await f.run({ action: 'pick', attemptId: ATTEMPT, questionId: Q(0).toUpperCase(), option: 2 })
    assert.equal(picked.status, 'picked')
    assert.deepEqual(f.calls.at(-1), ['pick', 'session-1', ATTEMPT, Q(0), 2])
  }))
