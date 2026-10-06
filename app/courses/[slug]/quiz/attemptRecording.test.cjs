// Run with the repository's lib/auth/test-loader.cjs preloader.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createQuizAttemptRecorder } = require('./attemptRecording.ts')

const questions = [
  { questionId: '11111111-1111-4111-8111-111111111111', publishedRevision: 1 },
  { questionId: '22222222-2222-4222-8222-222222222222', publishedRevision: 2 },
]
const retakeQuestions = [
  { questionId: '33333333-3333-4333-8333-333333333333', publishedRevision: 3 },
  { questionId: '44444444-4444-4444-8444-444444444444', publishedRevision: 4 },
]
const ids = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
]
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
const waitFor = async (condition, message) => {
  for (let i = 0; i < 500; i++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve: () => resolve() }
}

function fixture(options = {}) {
  const calls = []
  const states = []
  const attempts = new Map()
  let nextId = 0
  let signedOut = false
  let liveToken = 'opaque-test-token'
  const submittedTokens = []
  const apply = command => {
    if (signedOut) return reply({ status: 'signed-out' }, 401)
    if (submittedTokens.at(-1) !== liveToken) return reply({ status: 'session-changed' }, 409)
    let attempt = attempts.get(command.attemptId)
    if (command.operation === 'start') {
      if (!attempt) {
        attempt = { id: command.attemptId, revision: 0, status: 'in_progress', answers: new Map() }
        attempts.set(command.attemptId, attempt)
      }
    } else {
      if (!attempt) return reply({ status: 'not-found' }, 404)
      if (attempt.revision === command.expectedRevision + 1 && attempt.status ===
        (command.operation === 'finish' ? command.completion : 'in_progress') &&
        command.answers.every(answer => attempt.answers.get(answer.ordinal)?.optionIndex === answer.optionIndex)) {
        return reply({ status: 'saved', attempt: {
          id: attempt.id, revision: attempt.revision, status: attempt.status, questionCount: 2,
        } })
      }
      if (attempt.status !== 'in_progress' || attempt.revision !== command.expectedRevision) {
        return reply({ status: 'conflict' }, 409)
      }
      for (const answer of command.answers) attempt.answers.set(answer.ordinal, answer)
      attempt.revision += 1
      if (command.operation === 'finish') attempt.status = command.completion
    }
    return reply({ status: 'saved', attempt: {
      id: attempt.id, revision: attempt.revision, status: attempt.status, questionCount: 2,
    } })
  }
  const request = async (url, init) => {
    assert.equal(url, '/api/quiz-attempts')
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['x-campus-account-continuity'], 'opaque-test-token')
    assert.equal(init.headers['Content-Type'], 'application/json')
    const command = JSON.parse(init.body)
    calls.push(command)
    submittedTokens.push(init.headers['x-campus-account-continuity'])
    return options.onPost ? options.onPost(command, apply) : apply(command)
  }
  const recorder = createQuizAttemptRecorder('opaque-test-token', status => states.push(status), request, () => ids[nextId++])
  return { calls, states, attempts, submittedTokens, recorder,
    signOut: () => { signedOut = true }, switchSession: token => { liveToken = token } }
}

test('page A cannot acquire account B continuity after a switch before Start', async () => {
  const f = fixture()
  f.switchSession('account-b-token')
  f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.states.at(-1) === 'session-changed', 'old page was not rejected')
  assert.equal(f.attempts.size, 0)
  assert.deepEqual(f.calls.map(call => call.operation), ['start'])
  assert.deepEqual(f.submittedTokens, ['opaque-test-token'])
})

test('a delayed failed Start retry cannot replace the page token with the new session', async () => {
  const gate = deferred()
  let starts = 0
  const f = fixture({ onPost: async (command, apply) => {
    if (command.operation === 'start' && ++starts === 1) {
      await gate.promise
      throw new Error('request failed before a response')
    }
    return apply(command)
  } })
  f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => starts === 1, 'first Start did not begin')
  f.switchSession('account-b-token')
  gate.resolve()
  await waitFor(() => f.states.at(-1) === 'session-changed', 'retry was not rejected')
  assert.equal(f.attempts.size, 0)
  assert.deepEqual(f.submittedTokens, ['opaque-test-token', 'opaque-test-token'])
})

test('a session change while start, record or finish is in flight cannot write under the replacement session', async () => {
  for (const operation of ['start', 'record', 'finish']) {
    const gate = deferred()
    const f = fixture({ onPost: async (command, apply) => {
      if (command.operation === operation) await gate.promise
      return apply(command)
    } })
    const id = f.recorder.begin('financial-accounting-1', questions)
    if (operation !== 'start') await waitFor(() => f.attempts.has(id), 'Start was not saved')
    if (operation === 'record') f.recorder.select(0, 1)
    else if (operation === 'finish') f.recorder.finish('submitted')
    await waitFor(() => f.calls.some(call => call.operation === operation), `${operation} did not begin`)
    f.switchSession('account-b-token')
    gate.resolve()
    await waitFor(() => f.states.at(-1) === 'session-changed', `${operation} was not rejected`)
    if (operation === 'start') assert.equal(f.attempts.size, 0)
    else {
      assert.equal(f.attempts.get(id).revision, 0)
      assert.equal(f.attempts.get(id).status, 'in_progress')
    }
    assert.ok(f.submittedTokens.every(token => token === 'opaque-test-token'))
  }
})

test('duplicate Start keeps one attempt ID and one server start command', async () => {
  const gate = deferred()
  const f = fixture({ onPost: async (command, apply) => {
    if (command.operation === 'start') await gate.promise
    return apply(command)
  } })
  const first = f.recorder.begin('financial-accounting-1', questions)
  const second = f.recorder.begin('financial-accounting-1', questions)
  assert.equal(first, second)
  assert.equal(f.calls.filter(call => call.operation === 'start').length, 1)
  gate.resolve()
  await waitFor(() => f.attempts.has(first), 'Start was not saved')
  assert.equal(f.attempts.size, 1)
})

test('signed-in start, first answer, changed answer and partial history use one logical attempt', async () => {
  const f = fixture()
  const id = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(id), 'start was not recorded')
  f.recorder.select(0, 0)
  await waitFor(() => f.attempts.get(id).revision === 1, 'first answer was not recorded')
  f.recorder.select(0, 1)
  await waitFor(() => f.attempts.get(id).revision === 2, 'changed answer was not recorded')
  const attempt = f.attempts.get(id)
  assert.equal(attempt.status, 'in_progress')
  assert.equal(attempt.answers.size, 1)
  assert.deepEqual(attempt.answers.get(0), {
    questionId: questions[0].questionId, ordinal: 0, optionIndex: 1,
  })
  assert.deepEqual(f.calls.filter(call => call.operation === 'record').map(call => call.expectedRevision), [0, 1])
  assert.deepEqual(Object.keys(f.calls.find(call => call.operation === 'start')).sort(),
    ['attemptId', 'courseContentKey', 'operation', 'questions'])
  assert.deepEqual(f.calls.find(call => call.operation === 'start').questions,
    questions.map((question, ordinal) => ({ questionId: question.questionId,
      ordinal, publishedRevision: question.publishedRevision })))
  assert.equal(f.states.at(-1), 'recording')
})

test('delayed and retried record cannot overwrite the final manual submission', async () => {
  const gate = deferred()
  let records = 0
  const f = fixture({ onPost: async (command, apply) => {
    if (command.operation === 'record' && ++records === 1) {
      apply(command)
      await gate.promise
      throw new Error('response lost after commit')
    }
    return apply(command)
  } })
  const id = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(id), 'start was not recorded')
  f.recorder.select(0, 0)
  await waitFor(() => records === 1, 'first record did not start')
  f.recorder.select(0, 2)
  f.recorder.select(1, 1)
  f.recorder.finish('submitted')
  f.recorder.finish('timed_out')
  gate.resolve()
  await waitFor(() => f.states.at(-1) === 'saved', 'submission did not finish')
  const attempt = f.attempts.get(id)
  assert.equal(attempt.status, 'submitted')
  assert.equal(attempt.revision, 2)
  assert.equal(attempt.answers.size, 2)
  assert.equal(attempt.answers.get(0).optionIndex, 2)
  assert.equal(attempt.answers.get(1).optionIndex, 1)
  assert.equal(f.calls.filter(call => call.operation === 'finish').length, 1)
  assert.deepEqual(f.calls.filter(call => call.operation === 'record').map(call => call.expectedRevision), [0, 0])
})

test('timeout, redo, and retake each finish or start the correct attempt identity', async () => {
  const f = fixture()
  const first = f.recorder.begin('financial-accounting-1', questions)
  f.recorder.select(0, 1)
  f.recorder.finish('timed_out')
  await waitFor(() => f.attempts.get(first)?.status === 'timed_out', 'timeout did not finish')
  const redo = f.recorder.begin('financial-accounting-1', questions)
  f.recorder.select(0, 0)
  f.recorder.finish('submitted')
  await waitFor(() => f.attempts.get(redo)?.status === 'submitted', 'redo did not finish')
  const retake = f.recorder.begin('financial-accounting-1', retakeQuestions)
  f.recorder.select(0, 1)
  await waitFor(() => f.attempts.get(retake)?.answers.size === 1, 'retake answer was not recorded')
  assert.equal(new Set([first, redo, retake]).size, 3)
  assert.equal(f.attempts.get(redo).answers.get(0).questionId, questions[0].questionId)
  assert.equal(f.attempts.get(retake).answers.get(0).questionId, retakeQuestions[0].questionId)
  assert.equal(f.attempts.get(first).status, 'timed_out')
})

test('a signed-out start fails closed without persisting queued answers', async () => {
  const f = fixture()
  f.signOut()
  f.recorder.begin('financial-accounting-1', questions)
  f.recorder.select(0, 1)
  f.recorder.finish('submitted')
  await waitFor(() => f.states.at(-1) === 'session-changed', 'signed-out write was not rejected')
  assert.equal(f.attempts.size, 0)
  assert.deepEqual(f.calls.map(call => call.operation), ['start'])
})

test('continuity failure stops writes and does not switch the owner of an in-progress attempt', async () => {
  const f = fixture({ onPost: (command, apply) => command.operation === 'record'
    ? reply({ status: 'session-changed' }, 409) : apply(command) })
  const id = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(id), 'start was not recorded')
  f.recorder.select(0, 1)
  await waitFor(() => f.states.at(-1) === 'session-changed', 'continuity failure was not recognized')
  f.recorder.select(1, 0)
  f.recorder.finish('submitted')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(f.calls.filter(call => call.operation === 'record').length, 1)
  assert.equal(f.calls.filter(call => call.operation === 'finish').length, 0)
  assert.equal(f.attempts.get(id).revision, 0)
  assert.equal(f.attempts.get(id).status, 'in_progress')
})

test('recording failure never reports a saved attempt or blocks a later local quiz', async () => {
  const f = fixture({ onPost: (command, apply) => command.operation === 'record'
    ? reply({ status: 'unavailable' }, 503) : apply(command) })
  const first = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(first), 'start was not recorded')
  f.recorder.select(0, 1)
  await waitFor(() => f.states.at(-1) === 'unavailable', 'recording failure was not reported')
  f.recorder.finish('submitted')
  assert.equal(f.states.includes('saved'), false)
  assert.equal(f.attempts.get(first).status, 'in_progress')
  f.signOut()
  f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.states.at(-1) === 'session-changed', 'later signed-out write was not rejected')
})

test('a delayed old finish does not report success for a new attempt', async () => {
  const gate = deferred()
  const f = fixture({ onPost: async (command, apply) => {
    if (command.operation === 'finish' && command.attemptId === ids[0]) {
      await gate.promise
    }
    return apply(command)
  } })
  const first = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(first), 'first start was not recorded')
  f.recorder.finish('submitted')
  await waitFor(() => f.calls.some(call => call.operation === 'finish'), 'first finish did not start')
  const second = f.recorder.begin('financial-accounting-1', questions)
  await waitFor(() => f.attempts.has(second), 'second start was not recorded')
  gate.resolve()
  await waitFor(() => f.attempts.get(first).status === 'submitted', 'old finish did not complete')
  assert.equal(f.states.at(-1), 'recording')
  assert.equal(f.attempts.get(second).status, 'in_progress')
})
