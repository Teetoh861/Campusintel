// app/api/ai-practice/topic-route.test.cjs — "Quiz me on this topic" through the real route: the request checks, the
// session and page continuity, the course behind the slug, the flow and the mapping to and from the two database
// functions. Only authentication, the database and the provider are fixtures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')
const { createFakeCampusBotProvider } = require('../../../lib/campus-bot/provider.ts')

const USER = '82000000-0000-4000-8000-000000000001'
const SESSION = '82000000-0000-4000-8000-000000000002'
const ITEM = '82000000-0000-4000-8000-000000000003'
const COURSE = '82000000-0000-4000-8000-000000000004'
const GENERATION = '82000000-0000-4000-8000-000000000005'
const REQUEST = '82000000-0000-4000-8000-000000000006'
const QUIZ = { operation: 'generate-topic', courseSlug: 'principles-economics-1', itemId: ITEM, requestId: REQUEST }
const BODY = 'Demand falls when price rises because buyers switch to substitutes and their real income buys less of the good than before.'
const started = (extra = {}) => ({ state: 'started', generation_id: GENERATION, reservation_seconds: 300,
  model: 'claude-haiku-5-5', max_input_tokens: 20000, max_output_tokens: 8000, check: null,
  course: { code: 'ECO101', title: 'Principles of Economics I' },
  topic: { title: 'Demand', number: 3, revision: 2, pinned: false },
  passages: [{ heading: 'What you must know', body: BODY }, { heading: '3.1 The law of demand', body: BODY.replace('Demand', 'Quantity demanded') }],
  previous: [], ...extra })

async function fixture(run) {
  const original = Module._load
  const files = ['./route.ts', '../../../lib/auth/request.ts', '../../../lib/ai-practice/topic-set-server.ts',
    '../../../lib/ai-practice/topic-set.ts', '../../../lib/ai-practice/supabase-env.ts'].map(file => require.resolve(file))
  const saved = files.map(file => require.cache[file])
  const state = { replies: {}, script: {}, provider: true, signedIn: true,
    entitlement: { status: 'ok', entitlement: { plans_on_sale: true } } }
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
      if (name === '@/lib/campus-bot/provider' && parent?.filename.endsWith('/lib/ai-practice/topic-set-server.ts')) {
        return { campusBotProvider: () => state.provider ? provider : null }
      }
      return original.call(this, name, parent, ...rest)
    }
    const { POST } = require('./route.ts')
    const post = (command, headers = {}) => POST(new Request('https://campusintell.test/api/ai-practice', {
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

test('a quiz is admitted for the session’s student, written, settled and answered with the set to open', () => fixture(
  async ({ state, calls, post }) => {
    state.replies.begin_campus_bot_topic_set = started()
    state.replies.finish_campus_bot_topic_set = args => ({ state: 'finished', status: args.p_status })
    const response = await post(QUIZ)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await response.json(), { status: 'ready', setId: GENERATION })
    const begin = calls.find(call => call.name === 'begin_campus_bot_topic_set')
    assert.deepEqual({ ...begin.args, p_accepted_sources: undefined }, { p_session_id: SESSION, p_request_id: REQUEST,
      p_course_id: COURSE, p_item_id: ITEM, p_accepted_sources: undefined }, 'the student comes from the session')
    assert.ok(begin.args.p_accepted_sources.includes('paid'))
    const finish = calls.find(call => call.name === 'finish_campus_bot_topic_set')
    assert.equal(finish.args.p_user_id, USER)
    assert.equal(finish.args.p_status, 'generated')
    assert.equal(finish.args.p_question_set.source.kind, 'notes-topic')
    assert.equal(finish.args.p_question_set.source.itemId, ITEM)
    assert.equal(finish.args.p_question_set.source.revision, 2)
    assert.equal(finish.args.p_usage.model, 'claude-haiku-5-5')
    assert.equal(finish.args.p_check_usage, null)
    assert.deepEqual(calls.filter(call => call.name === 'provider').map(call => call.model), ['claude-haiku-5-5'])
  }))

test('a calculation course’s set is checked by the checking model before it is settled', () => fixture(
  async ({ state, calls, post }) => {
    state.replies.begin_campus_bot_topic_set = started({ check: { model: 'claude-sonnet-5-5', max_input_tokens: 10000, max_output_tokens: 3000 } })
    state.replies.finish_campus_bot_topic_set = args => ({ state: 'finished', status: args.p_status })
    state.script = { setCheck: 'drop-one' }
    assert.deepEqual(await (await post(QUIZ)).json(), { status: 'ready', setId: GENERATION })
    assert.deepEqual(calls.filter(call => call.name === 'provider').map(call => call.model),
      ['claude-haiku-5-5', 'claude-sonnet-5-5'])
    const finish = calls.find(call => call.name === 'finish_campus_bot_topic_set')
    assert.equal(finish.args.p_question_set.questions.length, 4)
    assert.equal(finish.args.p_check_usage.model, 'claude-sonnet-5-5')
  }))

test('every refusal is the shared Campus Bot state, with its status code', () => fixture(async ({ state, post }) => {
  const cases = [
    [{ state: 'not-entitled' }, 403, { status: 'not-entitled', notice: 'subscribe' }],
    [{ state: 'session-limit', resets_at: '2026-11-17T15:00:00Z' }, 429,
      { status: 'limit', limit: 'session', resetsAt: '2026-11-17T15:00:00Z' }],
    [{ state: 'pass-used' }, 429, { status: 'limit', limit: 'pass', resetsAt: null }],
    [{ state: 'undelivered-limit' }, 429, { status: 'limit', limit: 'undelivered', resetsAt: null }],
    [{ state: 'locked' }, 403, { status: 'locked', plansOnSale: true }],
    [{ state: 'busy' }, 409, { status: 'in-progress' }],
    [{ state: 'capacity' }, 503, { status: 'busy' }],
    [{ state: 'disabled' }, 503, { status: 'disabled' }],
    [{ state: 'too-short' }, 404, { status: 'not-found' }],
    [{ state: 'existing', generation_id: GENERATION, status: 'generated' }, 200, { status: 'ready', setId: GENERATION }],
    [{ state: 'started' }, 503, { status: 'unavailable' }],
    [started({ reservation_seconds: 120 }), 503, { status: 'unavailable' }],
    [started({ passages: [] }), 503, { status: 'unavailable' }],
    // A call is never made without the input cap the database admitted it with.
    [started({ max_input_tokens: undefined }), 503, { status: 'unavailable' }],
    [started({ check: { model: 'claude-sonnet-5-5', max_output_tokens: 3000 } }), 503, { status: 'unavailable' }],
    [{ state: 'something-new' }, 503, { status: 'unavailable' }],
  ]
  for (const [reply, code, body] of cases) {
    state.replies.begin_campus_bot_topic_set = reply
    const response = await post(QUIZ)
    assert.deepEqual([response.status, await response.json()], [code, body], JSON.stringify(reply))
  }
}))

test('the session, the page and the command are checked before anything is admitted', () => fixture(
  async ({ state, calls, post }) => {
    state.replies.begin_campus_bot_topic_set = started()
    assert.deepEqual(await (await post(QUIZ, { [AUTH_CONTINUITY_HEADER]: 'another-page' })).json(), { status: 'session-changed' })
    assert.deepEqual(await (await post({ ...QUIZ, courseSlug: 'Not A Slug' })).json(), { status: 'invalid-request' })
    assert.deepEqual(await (await post({ ...QUIZ, extra: true })).json(), { status: 'invalid-request' })
    assert.deepEqual(await (await post({ ...QUIZ, courseSlug: 'unknown-course' })).json(), { status: 'not-found' })
    state.signedIn = false
    const out = await post(QUIZ)
    assert.deepEqual([out.status, await out.json()], [401, { status: 'signed-out' }])
    assert.equal(calls.length, 0, 'no database call and no provider call')
    const foreign = await post(QUIZ, { Origin: 'https://elsewhere.test' })
    assert.notEqual(foreign.status, 200)
  }))

test('upload commands still take the upload path', () => fixture(async ({ calls, post }) => {
  const response = await post({ operation: 'generate', documentId: ITEM, requestId: REQUEST })
  assert.notEqual((await response.json()).status, 'ready')
  assert.equal(calls.some(call => call.name === 'begin_campus_bot_topic_set'), false)
}))
