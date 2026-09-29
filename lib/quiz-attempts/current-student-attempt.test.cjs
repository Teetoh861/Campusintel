const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./test-fixture.cjs')

test('signed-out, disabled and failed Auth never reach the course bridge or write RPC', async () => fixture(async f => {
  for (const [flag, status, http] of [['signedOut', 'signed-out', 401], ['enabled', 'unavailable', 503], ['authFailure', 'unavailable', 503]]) {
    f.state[flag] = flag !== 'enabled'
    const result = await f.post(f.start())
    assert.equal(result.response.status, http)
    assert.deepEqual(result.body, { status })
    assert.equal(f.calls.some(call => ['from', 'rpc'].includes(call[0])), false)
    f.state[flag] = flag === 'enabled'
    f.calls.length = 0
  }
}))

test('GET issues opaque continuity without exposing identity or touching history', async () => fixture(async f => {
  const response = await f.route.GET()
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(body).sort(), ['continuityToken', 'status'])
  assert.equal(body.status, 'ready')
  assert.doesNotMatch(JSON.stringify(body), new RegExp(f.id.user))
  assert.equal(require('../auth/account-continuity.ts').matchesAccountContinuityToken(body.continuityToken, f.id.user, f.id.session), true)
  assert.equal(f.calls.some(call => ['from', 'rpc'].includes(call[0])), false)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.match(response.headers.get('set-cookie'), /sb-fixture=rotated/)
  f.state.signedOut = true
  assert.equal((await f.route.GET()).status, 401)
}))

test('start resolves database identity by contentKey and derives the usable attempt count', async () => fixture(async f => {
  const result = await f.post(f.start())
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, { status: 'saved', attempt: { id: f.id.attempt,
    revision: 0, status: 'in_progress', questionCount: Math.min(f.quiz.maxQuizQuestions, f.quiz.questions.length) } })
  assert.match(result.response.headers.get('set-cookie'), /sb-fixture=rotated/)
  assert.equal(result.response.headers.get('cache-control'), 'private, no-store')
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 2)
  assert.deepEqual(f.calls.filter(call => call[0] === 'bridge'), [['bridge', 'content_key', f.course.contentKey]])
  const command = f.calls.find(call => call[0] === 'rpc')[1]
  assert.equal(command.p_session_id, f.id.session)
  assert.equal(command.p_course_id, f.id.course)
  assert.notEqual(command.p_course_id, f.course.id)
  assert.deepEqual(command.p_answers, [])
  assert.equal(command.p_expected_revision, null)
  assert.equal(Object.hasOwn(command, 'user_id'), false)
  assert.equal(Object.hasOwn(command, 'p_user_id'), false)
}))

test('caller identity, counts, correctness, score, section and timestamps are rejected', async () => fixture(async f => {
  for (const field of ['userId', 'user_id', 'sessionId', 'courseId', 'questionCount', 'score', 'is_correct', 'created_at']) {
    const result = await f.post({ ...f.start(), [field]: f.id.otherUser })
    assert.equal(result.response.status, 400, field)
  }
  for (const field of ['correctAnswer', 'isCorrect', 'is_correct', 'score', 'sectionLabel', 'section_label', 'answeredAt', 'answered_at']) {
    const result = await f.post({ ...f.record(), answers: [{ ...f.answer(), [field]: true }] })
    assert.equal(result.response.status, 400, field)
  }
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
}))

test('canonical server questions determine correctness and section labels for latest selections', async () => fixture(async f => {
  const question = f.quiz.questions[0]
  for (const selected of [question.correctAnswer, (question.correctAnswer + 1) % question.options.length]) {
    f.calls.length = 0
    const result = await f.post({ ...f.record(), answers: [f.answer(question, 0, selected)] })
    assert.equal(result.response.status, 200)
    assert.deepEqual(f.calls.find(call => call[0] === 'rpc')[1].p_answers, [{
      question_id: question.questionId, ordinal: 0, option_index: selected,
      is_correct: selected === question.correctAnswer, section_label: question.section,
    }])
    assert.deepEqual(Object.keys(result.body.attempt).sort(), ['id', 'questionCount', 'revision', 'status'])
    assert.equal(JSON.stringify(result.body).includes(question.question), false)
    assert.equal(JSON.stringify(result.body).includes('correctAnswer'), false)
  }
}))

test('invalid course, UUID, foreign-bank question, option, ordinal, duplicates and revisions fail closed', async () => fixture(async f => {
  const foreign = require('../data/quizzes.ts').getQuizByCourseSlug('business-statistics').questions[0]
  const bad = [
    { ...f.start(), courseContentKey: 'unknown-course' }, { ...f.start(), attemptId: 'not-a-uuid' },
    { ...f.record(), answers: [{ ...f.answer(), questionId: randomUUID() }] },
    { ...f.record(), answers: [f.answer(foreign)] },
    { ...f.record(), answers: [f.answer(f.quiz.questions[0], 0, f.quiz.questions[0].options.length)] },
    { ...f.record(), answers: [f.answer(f.quiz.questions[0], 0, -1)] },
    { ...f.record(), answers: [f.answer(f.quiz.questions[0], f.quiz.maxQuizQuestions)] },
    { ...f.record(), answers: [f.answer(), f.answer()] },
    { ...f.record(), answers: [f.answer(), f.answer(f.quiz.questions[1], 0)] },
    { ...f.record(), expectedRevision: -1 }, { ...f.record(), expectedRevision: 0.5 },
    { ...f.record(), expectedRevision: 2147483647 }, { ...f.record(), answers: [] },
  ]
  for (const input of bad) assert.equal((await f.post(input)).response.status, 400)
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
}))

test('missing or previous-account/session continuity prevents even registry access', async () => fixture(async f => {
  const otherToken = require('../auth/account-continuity.ts').issueAccountContinuityToken(f.id.otherUser, f.id.session)
  const oldSession = require('../auth/account-continuity.ts').issueAccountContinuityToken(f.id.user, f.id.otherSession)
  for (const token of [null, '', 'malformed', otherToken, oldSession]) {
    const result = await f.post(f.start(), token)
    assert.equal(result.response.status, 409)
    assert.deepEqual(result.body, { status: 'session-changed' })
  }
  assert.equal(f.calls.some(call => ['from', 'rpc'].includes(call[0])), false)
}))

test('revocation or account/session change during the course lookup stops the RPC', async () => fixture(async f => {
  for (const [change, status] of [
    [() => { f.state.signedOut = true }, 'signed-out'],
    [() => { f.state.user = f.id.otherUser }, 'session-changed'],
    [() => { f.state.session = f.id.otherSession }, 'session-changed'],
  ]) {
    f.state.user = f.id.user; f.state.session = f.id.session; f.state.signedOut = false
    f.state.onBridge = change
    const result = await f.post(f.start())
    assert.deepEqual(result.body, { status })
  }
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
}))

test('bridge failures, missing/mismatched links and RPC failures return private unavailable results', async () => fixture(async f => {
  for (const flag of ['bridgeFailure', 'bridgeMissing', 'bridgeMismatch', 'rpcFailure']) {
    f.state[flag] = true
    const result = await f.post(f.start())
    assert.equal(result.response.status, 503)
    assert.deepEqual(result.body, { status: 'unavailable' })
    f.state[flag] = false
  }
}))

test('submission and timer completion flush only explicit answered patches', async () => fixture(async f => {
  for (const completion of ['submitted', 'timed_out']) {
    f.calls.length = 0
    const result = await f.post({ ...f.start(), operation: 'finish', completion, expectedRevision: 7, answers: [] })
    assert.equal(result.response.status, 200)
    const command = f.calls.find(call => call[0] === 'rpc')[1]
    assert.equal(command.p_status, completion)
    assert.equal(command.p_expected_revision, 7)
    assert.deepEqual(command.p_answers, [])
  }
}))

test('ownership, conflict, finalized and post-preflight session loss have minimal HTTP responses', async () => fixture(async f => {
  for (const [status, http] of [['not-found', 404], ['conflict', 409], ['finalized', 409], ['signed-out', 401]]) {
    f.state.rpcResult = { status }
    const result = await f.post(f.record())
    assert.equal(result.response.status, http)
    assert.deepEqual(result.body, { status })
  }
}))

test('same-origin, JSON, body size and malformed requests fail before provider access', async () => fixture(async f => {
  for (const [body, headers, status] of [
    [f.start(), { origin: 'https://evil.example' }, 403],
    [f.start(), { 'sec-fetch-site': 'cross-site' }, 403],
    [f.start(), { 'content-type': 'text/plain' }, 415],
    ['{', {}, 400], [' '.repeat(16 * 1024 + 1), {}, 413],
  ]) assert.equal((await f.post(body, f.token(), headers)).response.status, status)
  assert.deepEqual(f.calls, [])
}))

test('a full canonical attempt patch fits the quiz-specific bounded parser', async () => fixture(async f => {
  const size = Math.min(f.quiz.maxQuizQuestions, f.quiz.questions.length)
  const input = { ...f.record(), answers: f.quiz.questions.slice(0, size).map((question, ordinal) => f.answer(question, ordinal)) }
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 4096)
  assert.equal((await f.post(input)).response.status, 200)
  assert.equal(f.calls.find(call => call[0] === 'rpc')[1].p_answers.length, size)
}))

test('fixtures restore loader, cached modules and configuration', async () => {
  const Module = require('node:module')
  const load = Module._load
  const keys = Object.keys(require.cache).sort()
  const secret = process.env.SUPABASE_SECRET_KEY
  await fixture(async f => { await f.post(f.start()) })
  assert.equal(Module._load, load)
  assert.deepEqual(Object.keys(require.cache).sort(), keys)
  assert.equal(process.env.SUPABASE_SECRET_KEY, secret)
})
