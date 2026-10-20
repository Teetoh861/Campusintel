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

test('the attempt endpoint cannot mint a replacement page identity after mount', async () => fixture(async f => {
  assert.equal(f.route.GET, undefined)
  assert.equal(f.domain.getQuizAttemptContext, undefined)
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
  assert.deepEqual(f.calls.filter(call => call[0] === 'published'), [['published', f.course.contentKey]])
  const command = f.calls.find(call => call[0] === 'rpc')[1]
  assert.equal(command.p_session_id, f.id.session)
  assert.equal(command.p_course_id, f.id.course)
  assert.notEqual(command.p_course_id, f.course.id)
  assert.deepEqual(command.p_answers, f.start().questions.map(question => ({
    question_id: question.questionId, ordinal: question.ordinal,
    content_revision: question.publishedRevision,
  })))
  assert.equal(command.p_expected_revision, null)
  assert.equal(Object.hasOwn(command, 'user_id'), false)
  assert.equal(Object.hasOwn(command, 'p_user_id'), false)
  const steps = f.calls.map(call => call[0])
  assert.ok(steps.indexOf('bridge') < steps.indexOf('recovery'))
  assert.ok(steps.indexOf('recovery') < steps.indexOf('published'))
  assert.ok(steps.indexOf('published') < steps.indexOf('rpc'))
  assert.equal(f.calls.filter(call => call[0] === 'recovery').length, 1, 'fresh START has no final recovery re-read')
}))

test('exact initial START recovery precedes publication and survives republish, withdrawal and unavailable reads', async () => fixture(async f => {
  f.state.recoveryData = f.storedStart()
  for (const change of [() => { f.publishedRows[0].revision = 2 },
    () => { f.publishedRows.splice(0, 1) }, () => { f.state.publishedFailure = true }]) {
    f.calls.length = 0; change()
    const result = await f.post(f.start())
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.body, { status: 'saved', attempt: { id: f.id.attempt,
      revision: 0, status: 'in_progress', questionCount: f.start().questions.length } })
    assert.equal(f.calls.some(call => ['published', 'rpc'].includes(call[0])), false)
    assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 2)
    const steps = f.calls.map(call => call[0])
    assert.ok(steps.indexOf('bridge') < steps.indexOf('recovery'))
    assert.ok(steps.lastIndexOf('getUser') > steps.indexOf('recovery'))
    const reads = steps.flatMap((step, index) => step === 'recovery' ? [index] : [])
    assert.equal(reads.length, 2)
    assert.ok(steps.lastIndexOf('getUser') < reads[1], 'second live Auth check precedes final durable confirmation')
  }
  f.state.recoveryData.quiz_attempt_questions.reverse()
  assert.equal((await f.post(f.start())).response.status, 200, 'stored array order is interpreted through exact ordinals')
}))

test('final recovery failure or changed state terminates known-existing START without publication or write fallthrough', async () => fixture(async f => {
  const cases = [
    [() => { f.state.recoveryData = null }, 'signed-out'],
    [() => { f.state.recoveryFailure = true }, 'unavailable'],
    [() => { f.state.recoveryData.quiz_attempt_questions = null }, 'unavailable'],
    [() => { f.state.recoveryData.course_id = randomUUID() }, 'conflict'],
    [() => { f.state.recoveryData.quiz_attempt_questions[0].content_revision++ }, 'conflict'],
    [() => { f.state.recoveryData.revision = 1 }, 'conflict'],
    [() => { f.state.recoveryData.finished_at = '2026-10-10T00:00:00Z' }, 'conflict'],
    [() => { f.state.recoveryData.status = 'submitted'; f.state.recoveryData.finished_at = '2026-10-10T00:00:00Z' }, 'finalized'],
    [() => { f.state.recoveryData.status = 'timed_out'; f.state.recoveryData.finished_at = '2026-10-10T00:00:00Z' }, 'finalized'],
  ]
  for (const [change, expected] of cases) {
    f.state.recoveryData = f.storedStart(); f.state.recoveryFailure = false
    f.calls.length = 0
    let reads = 0
    f.state.onRecovery = () => { if (++reads === 2) change() }
    const result = await f.post(f.start())
    assert.deepEqual(result.body, { status: expected })
    assert.notEqual(result.response.status, 200)
    assert.equal(reads, 2)
    assert.equal(f.calls.some(call => ['published', 'rpc'].includes(call[0])), false)
  }
}))

test('absent START still requires current usable count and published revisions, never creating from stale or unavailable content', async () => fixture(async f => {
  f.publishedRows[0].revision = 2
  assert.equal((await f.post(f.start())).body.status, 'conflict')
  // Keep the usable count at its cap when withdrawing a selected question, so
  // this tests selection mismatch independently of the separate count rule.
  f.publishedRows.push({ ...f.publishedRows[1], item_id: randomUUID(), question_id: randomUUID() })
  f.publishedRows.splice(0, 1)
  assert.equal((await f.post(f.start())).body.status, 'conflict')
  assert.equal((await f.post({ ...f.start(), questions: f.start().questions.slice(1) })).body.status, 'invalid-request')
  assert.equal((await f.post({ ...f.start(), questions: [...f.start().questions, f.start().questions[0]] })).body.status, 'invalid-request')
  f.state.publishedFailure = true
  assert.equal((await f.post(f.start())).body.status, 'unavailable')
  f.state.publishedFailure = false; f.publishedRows.length = 0
  assert.equal((await f.post(f.start())).body.status, 'unavailable', 'empty usable bank cannot create')
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
  assert.ok(f.calls.some(call => call[0] === 'published'))
}))

test('existing START requires exact course, count, question, ordinal and revision and never falls through to a new write', async () => fixture(async f => {
  const original = f.storedStart()
  for (const change of [row => { row.course_id = randomUUID() }, row => { row.question_count-- },
    row => { row.quiz_attempt_questions[0].question_id = randomUUID() },
    row => { row.quiz_attempt_questions[0].ordinal = 1 }, row => { row.quiz_attempt_questions[0].content_revision = 2 },
    row => { row.quiz_attempt_questions.pop() }, row => { row.revision = 1 }]) {
    f.state.recoveryData = structuredClone(original); change(f.state.recoveryData)
    assert.deepEqual((await f.post(f.start())).body, { status: 'conflict' })
  }
  f.state.recoveryData = { ...original, status: 'submitted', finished_at: '2026-10-10T00:00:00Z' }
  assert.deepEqual((await f.post(f.start())).body, { status: 'finalized' })
  assert.equal(f.calls.some(call => ['published', 'rpc'].includes(call[0])), false)
}))

test('fresh START racing an already-advanced attempt cannot acknowledge a noninitial saved result', async () => fixture(async f => {
  for (const [status, revision, expected] of [['in_progress', 1, 'conflict'], ['submitted', 1, 'finalized'], ['timed_out', 1, 'finalized']]) {
    f.state.rpcResult = { status: 'saved', attempt: { id: f.id.attempt,
      questionCount: f.start().questions.length, status, revision } }
    assert.deepEqual((await f.post(f.start())).body, { status: expected })
  }
}))

test('owner read hides another student, malformed/failed reads fail closed, and recovery rechecks live session before acknowledgment', async () => fixture(async f => {
  f.state.recoveryData = { ...f.storedStart(), user_id: f.id.otherUser }
  f.state.rpcResult = { status: 'not-found' }
  assert.deepEqual((await f.post(f.start())).body, { status: 'not-found' })
  f.calls.length = 0; f.state.recoveryData = f.storedStart()
  for (const change of [() => { f.state.signedOut = true }, () => { f.state.user = f.id.otherUser },
    () => { f.state.session = f.id.otherSession }]) {
    f.state.onRecovery = change
    const pageToken = f.token()
    const result = await f.post(f.start(), pageToken)
    assert.ok(['signed-out', 'session-changed'].includes(result.body.status))
    f.state.signedOut = false; f.state.user = f.id.user; f.state.session = f.id.session
  }
  f.state.onRecovery = null; f.state.recoveryData = { ...f.storedStart(), quiz_attempt_questions: null }
  assert.deepEqual((await f.post(f.start())).body, { status: 'unavailable' })
  f.state.recoveryFailure = true
  assert.deepEqual((await f.post(f.start())).body, { status: 'unavailable' })
  assert.equal(f.calls.some(call => ['published', 'rpc'].includes(call[0])), false)
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

test('answer writes contain only selected IDs and options; SQL owns canonical correctness', async () => fixture(async f => {
  const question = f.quiz.questions[0]
  for (const selected of [question.correctAnswer, (question.correctAnswer + 1) % question.options.length]) {
    f.calls.length = 0
    const result = await f.post({ ...f.record(), answers: [f.answer(question, 0, selected)] })
    assert.equal(result.response.status, 200)
    assert.deepEqual(f.calls.find(call => call[0] === 'rpc')[1].p_answers, [{
      question_id: question.questionId, ordinal: 0, option_index: selected,
    }])
    assert.equal(f.calls.find(call => call[0] === 'rpc')[1].p_question_count, 0)
    assert.deepEqual(Object.keys(result.body.attempt).sort(), ['id', 'questionCount', 'revision', 'status'])
    assert.equal(JSON.stringify(result.body).includes(question.question), false)
    assert.equal(JSON.stringify(result.body).includes('correctAnswer'), false)
  }
}))

test('invalid course, UUID, selected set, answer shape and revisions fail closed', async () => fixture(async f => {
  const bad = [
    { ...f.start(), courseContentKey: 'unknown-course' }, { ...f.start(), attemptId: 'not-a-uuid' },
    { ...f.start(), questions: f.start().questions.slice(1) },
    { ...f.start(), questions: f.start().questions.map((question, ordinal) =>
      ordinal === 0 ? { ...question, publishedRevision: 99 } : question) },
    { ...f.start(), questions: f.start().questions.map((question, ordinal) =>
      ordinal === 0 ? { ...question, questionId: randomUUID() } : question) },
    { ...f.start(), questions: f.start().questions.map((question, ordinal) =>
      ordinal === 1 ? { ...question, questionId: f.start().questions[0].questionId } : question) },
    { ...f.start(), questions: f.start().questions.map((question, ordinal) =>
      ordinal === 0 ? { ...question, ordinal: 1 } : question) },
    { ...f.record(), answers: [f.answer(f.quiz.questions[0], 0, -1)] },
    { ...f.record(), answers: [f.answer(), { ...f.answer(), score: 1 }] },
    { ...f.record(), expectedRevision: -1 }, { ...f.record(), expectedRevision: 0.5 },
    { ...f.record(), expectedRevision: 2147483647 }, { ...f.record(), answers: [] },
  ]
  for (const input of bad) assert.ok([400, 409].includes((await f.post(input)).response.status))
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

test('a page issued for A cannot start under B or a replacement session for A', async () => fixture(async f => {
  const pageToken = f.token()
  for (const [user, session] of [[f.id.otherUser, f.id.session], [f.id.user, f.id.otherSession]]) {
    f.state.user = user
    f.state.session = session
    const result = await f.post(f.start(), pageToken)
    assert.equal(result.response.status, 409)
    assert.deepEqual(result.body, { status: 'session-changed' })
  }
  assert.equal(f.calls.some(call => ['published', 'from', 'rpc'].includes(call[0])), false)
}))

test('a revoked live session rejects the page token before any write', async () => fixture(async f => {
  const pageToken = f.token()
  f.state.signedOut = true
  const result = await f.post(f.start(), pageToken)
  assert.equal(result.response.status, 401)
  assert.deepEqual(result.body, { status: 'signed-out' })
  assert.equal(f.calls.some(call => ['published', 'from', 'rpc'].includes(call[0])), false)
}))

test('start, record and finish recheck revocation and account/session changes in flight', async () => fixture(async f => {
  for (const operation of ['start', 'record', 'finish']) {
    for (const [change, status] of [
      [() => { f.state.signedOut = true }, 'signed-out'],
      [() => { f.state.user = f.id.otherUser }, 'session-changed'],
      [() => { f.state.session = f.id.otherSession }, 'session-changed'],
    ]) {
      f.state.user = f.id.user; f.state.session = f.id.session; f.state.signedOut = false
      f.state.onBridge = change
      const input = operation === 'start' ? f.start() : operation === 'record' ? f.record()
        : { ...f.record(), operation: 'finish', completion: 'submitted' }
      const result = await f.post(input)
      assert.deepEqual(result.body, { status }, operation)
    }
  }
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
}))

test('bridge failures, missing/mismatched links and RPC failures return private unavailable results', async () => fixture(async f => {
  for (const flag of ['bridgeFailure', 'bridgeMissing', 'bridgeMismatch', 'publishedFailure', 'rpcFailure']) {
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
    const result = await f.post({ ...f.record(), operation: 'finish', completion, expectedRevision: 7, answers: [] })
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
  const input = { ...f.record(), answers: f.managedQuestions.slice(0, size).map((question, ordinal) => f.answer(question, ordinal)) }
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

test('a new START for a course the plan does not include is locked and never written', async () => fixture(async f => {
  f.state.publishedLocked = true
  const { response, body } = await f.post(f.start())
  assert.equal(response.status, 403)
  assert.equal(body.status, 'locked')
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false)
}))
