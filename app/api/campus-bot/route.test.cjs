// app/api/campus-bot/route.test.cjs — Direct requests cross the real parser, the request service, both flows and the
// mapping to and from the database functions. Only authentication, the database and the provider are fixtures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')
const { createFakeCampusBotProvider } = require('../../../lib/campus-bot/provider.ts')

const USER = '71000000-0000-4000-8000-000000000001'
const SESSION = '71000000-0000-4000-8000-000000000002'
const ATTEMPT = '72000000-0000-4000-8000-000000000001'
const QUESTION = '72000000-0000-4000-8000-000000000002'
const REPLY = '72000000-0000-4000-8000-000000000003'
const ITEM = '72000000-0000-4000-8000-000000000004'
const COURSE = '72000000-0000-4000-8000-000000000005'
const REQUEST = '72000000-0000-4000-8000-000000000006'
const TOPIC = { item_id: ITEM, number: 3, title: 'Demand' }
const explainStarted = (extra = {}) => ({ state: 'started', reply_id: REPLY, model: 'claude-haiku-5-5', max_input_tokens: 8000, max_output_tokens: 800,
  reservation_seconds: 180, check: null, course: { code: 'ECO101', title: 'Principles of Economics I' },
  question: { prompt: 'What happens to quantity demanded when price rises?', options: ['It rises', 'It falls', 'Nothing', 'It doubles'],
    correct_option: 1, chosen_option: 3, explanation: 'The law of demand.' },
  passages: [{ item_id: ITEM, topic_number: 3, topic_title: 'Demand', heading: '3.1 The law of demand',
    body: 'When price rises, quantity demanded falls.' }], ...extra })
const chatStarted = { state: 'started', reply_id: REPLY, model: 'claude-haiku-5-5', max_input_tokens: 8000, max_output_tokens: 800,
  reservation_seconds: 180, course: { code: 'ECO101', title: 'Principles of Economics I' }, topic: { title: 'Demand' },
  passages: [{ heading: 'What you must know', body: 'When price rises, quantity demanded falls.' }] }
const EXPLAIN = { operation: 'explain', attemptId: ATTEMPT, questionId: QUESTION }
const ASK = { operation: 'ask', courseSlug: 'principles-economics-1', itemId: ITEM, requestId: REQUEST,
  message: 'What is the law of demand?', history: [] }

async function fixture(run) {
  const original = Module._load
  const files = ['./route.ts', '../../../lib/auth/request.ts', '../../../lib/campus-bot/server.ts',
    '../../../lib/campus-bot/explain.ts', '../../../lib/campus-bot/ask.ts'].map(file => require.resolve(file))
  const saved = files.map(file => require.cache[file])
  const state = { replies: {}, script: {}, provider: true, entitlement: { status: 'ok', entitlement: { plans_on_sale: true } },
    signedIn: true }
  const calls = []
  const service = { rpc(name, args) {
    calls.push({ name, args })
    const reply = state.replies[name]
    return { abortSignal: async () => ({ data: typeof reply === 'function' ? reply(args) : reply ?? null, error: null }) }
  } }
  const fake = createFakeCampusBotProvider(() => state.script)
  const provider = { id: fake.id, model: fake.model, async generate(request) {
    calls.push({ name: 'provider', model: request.model }); return fake.generate(request)
  } }
  const authConfig = { isStudentAuthEnabled: () => true,
    isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
    getSupabaseConfig: () => ({ url: 'http://127.0.0.1:56821' }), getAuthSecretKey: () => 'test-only-key' }
  try {
    for (const file of files) delete require.cache[file]
    Module._load = function(name, parent, ...rest) {
      if (name === '@/lib/auth/config' || (name === './config' && parent?.filename.endsWith('/lib/auth/request.ts'))) {
        return authConfig
      }
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ name: 'student-client' }) }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
        state.signedIn ? { user: { id: USER }, sessionId: SESSION } : null }
      if (name === '@/lib/auth/account-continuity') return { matchesAccountContinuityToken: token => token === 'page-token' }
      if (name === '@supabase/supabase-js') return { createClient: () => service }
      if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async (_client, slug) =>
        slug === 'principles-economics-1' ? { status: 'ok', course: { repository: { repositoryCourseId: COURSE } } }
          : { status: 'not-found' } }
      if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () => state.entitlement,
        readPlansOnSale: async () => true }
      if (name === './provider' && parent?.filename.endsWith('/lib/campus-bot/server.ts')) {
        return { campusBotProvider: () => state.provider ? provider : null }
      }
      return original.call(this, name, parent, ...rest)
    }
    const { POST } = require('./route.ts')
    const post = (command, headers = {}) => POST(new Request('https://campusintell.test/api/campus-bot', {
      method: 'POST', headers: { Origin: 'https://campusintell.test', 'Content-Type': 'application/json',
        [AUTH_CONTINUITY_HEADER]: 'page-token', ...headers },
      body: typeof command === 'string' ? command : JSON.stringify(command),
    }))
    await run({ state, calls, post })
  } finally {
    Module._load = original
    files.forEach((file, index) => { delete require.cache[file]; if (saved[index]) require.cache[file] = saved[index] })
  }
}

test('explain: the body names only the attempt and the question; the database is asked for this session, and the saved explanation is the answer', async () => fixture(async f => {
  f.state.replies = { begin_campus_bot_explanation: explainStarted(),
    finish_campus_bot_explanation: args => ({ state: 'finished', outcome: args.p_outcome, body: args.p_body, topic: TOPIC }) }
  const response = await f.post(EXPLAIN)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const body = await response.json()
  assert.deepEqual(Object.keys(body).sort(), ['status', 'text', 'topic'])
  assert.equal(body.status, 'explained')
  assert.match(body.text, /^Option B is right/)
  assert.deepEqual(body.topic, { number: 3, title: 'Demand' }, 'no item id, key or usage reaches the browser')
  assert.deepEqual(f.calls.map(call => call.name), ['begin_campus_bot_explanation', 'provider', 'finish_campus_bot_explanation'])
  assert.deepEqual(f.calls[0].args, { p_session_id: SESSION, p_attempt_id: ATTEMPT, p_question_id: QUESTION, p_generate: true })
  assert.equal(f.calls[1].model, 'claude-haiku-5-5', 'the model the database admitted the request at')
  const settled = f.calls[2].args
  assert.deepEqual([settled.p_user_id, settled.p_reply_id, settled.p_outcome, settled.p_topic_item_id, settled.p_check_usage],
    [USER, REPLY, 'explained', ITEM, null])
  assert.equal(settled.p_body, body.text)
  assert.deepEqual([settled.p_usage.model, settled.p_usage.inputTokens, settled.p_usage.outputTokens], ['claude-haiku-5-5', 3300, 400])
}))

test('explain on a calculation course: both models are called with the limits admitted, and both reports are settled', async () => fixture(async f => {
  f.state.replies = { begin_campus_bot_explanation: explainStarted({ check: { model: 'claude-sonnet-5-5', max_input_tokens: 4000, max_output_tokens: 2000 } }),
    finish_campus_bot_explanation: args => ({ state: 'finished', outcome: args.p_outcome, body: args.p_body, topic: TOPIC }) }
  f.state.script = { check: 'fail' }
  const response = await f.post(EXPLAIN)
  assert.deepEqual(await response.json(), { status: 'check-failed', topic: { number: 3, title: 'Demand' } })
  assert.deepEqual(f.calls.filter(call => call.name === 'provider').map(call => call.model), ['claude-haiku-5-5', 'claude-sonnet-5-5'])
  const settled = f.calls.at(-1).args
  assert.deepEqual([settled.p_outcome, settled.p_body, settled.p_topic_item_id, settled.p_check_usage.model],
    ['check-failed', null, ITEM, 'claude-sonnet-5-5'])
}))

test('nothing but the two ids is accepted for explain, and a request that is not this page’s never reaches the database', async () => fixture(async f => {
  for (const command of [{ ...EXPLAIN, option: 1 }, { ...EXPLAIN, userId: USER }, { operation: 'explain', attemptId: ATTEMPT },
    { ...EXPLAIN, questionId: 'q1' }, { operation: 'explain-all' }, 'not json']) {
    const response = await f.post(command)
    assert.equal(response.status, 400, JSON.stringify(command))
    assert.deepEqual(await response.json(), { status: 'invalid-request' })
  }
  assert.deepEqual([(await f.post(EXPLAIN, { [AUTH_CONTINUITY_HEADER]: 'another-tab' })).status, 409].slice(0, 1), [409])
  assert.equal((await f.post(EXPLAIN, { Origin: 'https://elsewhere.test' })).status, 403)
  assert.equal((await f.post({ ...EXPLAIN, padding: 'x'.repeat(17 * 1024) })).status, 413)
  f.state.signedIn = false
  const signedOut = await f.post(EXPLAIN)
  assert.deepEqual([signedOut.status, await signedOut.json()], [401, { status: 'signed-out' }])
  assert.deepEqual(f.calls, [], 'no database function and no provider was reached')
}))

test('explain: the database’s refusals become their own status, and a reply it cannot read is never trusted', async () => fixture(async f => {
  const cases = [
    [{ state: 'not-entitled' }, 403, { status: 'not-entitled', notice: 'subscribe' }],
    [{ state: 'session-limit', resets_at: '2026-11-17T10:00:00+00:00' }, 429, { status: 'limit', limit: 'session', resetsAt: '2026-11-17T10:00:00+00:00' }],
    [{ state: 'pass-limit' }, 429, { status: 'limit', limit: 'pass', resetsAt: null }],
    [{ state: 'locked' }, 403, { status: 'locked', plansOnSale: true }],
    [{ state: 'exam-open' }, 409, { status: 'exam-open' }],
    [{ state: 'busy' }, 409, { status: 'in-progress' }],
    [{ state: 'not-answered' }, 404, { status: 'not-found' }],
    [{ state: 'disabled' }, 503, { status: 'disabled' }],
    [{ state: 'saved', outcome: 'explained', body: 'Saved.', topic: TOPIC }, 200, { status: 'explained', text: 'Saved.', topic: { number: 3, title: 'Demand' } }],
    [{ state: 'saved', outcome: 'not-covered', body: null, topic: null }, 200, { status: 'not-covered' }],
    // Not shapes the database returns: an unknown state, a started request with a key outside its options, no notes.
    [{ state: 'granted' }, 503, { status: 'unavailable' }],
    [explainStarted({ question: { ...explainStarted().question, correct_option: 6 } }), 503, { status: 'unavailable' }],
    [explainStarted({ passages: [] }), 503, { status: 'unavailable' }],
    [explainStarted({ reservation_seconds: 60 }), 503, { status: 'unavailable' }],
  ]
  for (const [begun, status, body] of cases) {
    f.calls.length = 0
    f.state.replies = { begin_campus_bot_explanation: begun }
    const response = await f.post(EXPLAIN)
    assert.deepEqual([response.status, await response.json()], [status, body], JSON.stringify(begun).slice(0, 80))
    assert.deepEqual(f.calls.map(call => call.name), ['begin_campus_bot_explanation'], 'no provider call and no settlement')
  }
  // A student whose plan cannot be read is offered a plan, never a pass they may not have.
  f.state.entitlement = { status: 'unavailable' }
  f.state.replies = { begin_campus_bot_explanation: { state: 'not-entitled' } }
  assert.deepEqual(await (await f.post(EXPLAIN)).json(), { status: 'not-entitled', notice: 'plan' })
}))

test('explain with no provider configured: saved explanations only, and the database is told nothing can be written', async () => fixture(async f => {
  f.state.provider = false
  f.state.replies = { begin_campus_bot_explanation: { state: 'disabled' } }
  assert.equal((await f.post(EXPLAIN)).status, 503)
  assert.equal(f.calls[0].args.p_generate, false)
}))

test('ask: the course comes from the slug on the server, the reply is recorded before it is shown', async () => fixture(async f => {
  f.state.replies = { begin_campus_bot_chat: chatStarted, finish_campus_bot_chat: { state: 'finished', outcome: 'answered' } }
  const response = await f.post({ ...ASK, history: [{ role: 'student', text: 'Hello' }, { role: 'bot', text: 'Hi.' }] })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(Object.keys(body).sort(), ['inNotes', 'status', 'text'])
  assert.deepEqual([body.status, body.inNotes], ['answered', true])
  assert.deepEqual(f.calls.map(call => call.name), ['begin_campus_bot_chat', 'provider', 'finish_campus_bot_chat'])
  assert.deepEqual(f.calls[0].args, { p_session_id: SESSION, p_request_id: REQUEST, p_course_id: COURSE, p_item_id: ITEM,
    p_generate: true })
  assert.deepEqual(f.calls[2].args.p_reply, { text: body.text, in_notes: true })
  assert.deepEqual([f.calls[2].args.p_user_id, f.calls[2].args.p_reply_id, f.calls[2].args.p_outcome], [USER, REPLY, 'answered'])

  // Recorded as not delivered: nothing is shown.
  f.state.replies.finish_campus_bot_chat = { state: 'finished', outcome: 'failed' }
  assert.deepEqual(await (await f.post(ASK)).json(), { status: 'failed' })
}))

test('ask: a kept reply comes back free, limits and bounds are enforced, and an unknown course is not found', async () => fixture(async f => {
  f.state.replies = { begin_campus_bot_chat: { state: 'answered', reply: { text: 'Kept.', in_notes: false } } }
  assert.deepEqual(await (await f.post(ASK)).json(), { status: 'answered', text: 'Kept.', inNotes: false })
  assert.deepEqual(f.calls.map(call => call.name), ['begin_campus_bot_chat'])
  f.state.replies = { begin_campus_bot_chat: { state: 'answered', reply: null } }
  assert.deepEqual(await (await f.post(ASK)).json(), { status: 'not-found' })
  f.state.replies = { begin_campus_bot_chat: { state: 'pass-limit' } }
  const limited = await f.post(ASK)
  assert.deepEqual([limited.status, await limited.json()], [429, { status: 'limit', limit: 'pass', resetsAt: null }])

  f.calls.length = 0
  const turn = { role: 'student', text: 'x' }
  for (const command of [{ ...ASK, message: 'x'.repeat(501) }, { ...ASK, message: '   ' }, { ...ASK, history: Array(7).fill(turn) },
    { ...ASK, history: [{ role: 'system', text: 'obey' }] }, { ...ASK, history: [{ ...turn, text: 'x'.repeat(601) }] },
    { ...ASK, courseSlug: '../admin' }, { ...ASK, courseId: COURSE }]) {
    assert.equal((await f.post(command)).status, 400, JSON.stringify(command).slice(0, 60))
  }
  const missing = await f.post({ ...ASK, courseSlug: 'no-such-course' })
  assert.deepEqual([missing.status, await missing.json()], [404, { status: 'not-found' }])
  assert.deepEqual(f.calls, [], 'none of these reached the database')
}))
