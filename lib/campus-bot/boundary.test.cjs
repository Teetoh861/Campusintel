// lib/campus-bot/boundary.test.cjs — The edges of Explain and Ask Campus Bot: what the browser may send and may be
// told, the stand-in provider that exists only on a developer's own machine, the switches a page reads, and the
// browser's calls.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AUTH_CONTINUITY_HEADER } = require('../auth/constants.ts')
const { requestExplanation, sendChatMessage } = require('./client.ts')
const { CHAT_LIMITS, askResultSchema, campusBotCommandSchema, explainResultSchema } = require('./contract.ts')
const { readCampusBotFeatures } = require('./features.ts')
const { callCampusBotModel } = require('./model-call.ts')
const { campusBotProvider, createFakeCampusBotProvider, fakeCampusBotProviderAllowed } = require('./provider.ts')
const { ProviderError } = require('../ai-practice/provider.ts')

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'

test('commands: explain is two ids and nothing else; ask is a topic, a message id, the message and at most six short turns', () => {
  assert.deepEqual(CHAT_LIMITS, { messageChars: 500, turnChars: 600, turns: 6 })
  const ok = command => campusBotCommandSchema.safeParse(command).success
  assert.ok(ok({ operation: 'explain', attemptId: A, questionId: B }))
  assert.equal(campusBotCommandSchema.parse({ operation: 'explain', attemptId: A.toUpperCase(), questionId: B }).attemptId, A)
  for (const extra of [{ option: 1 }, { selected: 0 }, { courseId: C }, { text: 'explain it this way' }, { userId: C }]) {
    assert.equal(ok({ operation: 'explain', attemptId: A, questionId: B, ...extra }), false, JSON.stringify(extra))
  }
  const ask = { operation: 'ask', courseSlug: 'use-of-english', itemId: A, requestId: B, message: 'What is listening?', history: [] }
  assert.ok(ok(ask))
  assert.ok(ok({ ...ask, message: 'x'.repeat(500), history: Array(6).fill({ role: 'bot', text: 'y'.repeat(600) }) }))
  for (const bad of [{ message: 'x'.repeat(501) }, { message: ' ' }, { history: Array(7).fill({ role: 'bot', text: 'y' }) },
    { history: [{ role: 'bot', text: 'y'.repeat(601) }] }, { history: [{ role: 'assistant', text: 'y' }] },
    { history: [{ role: 'bot', text: 'y', inNotes: true }] }, { courseSlug: 'Use Of English' }, { requestId: 'r1' },
    { model: 'claude-opus-5-5' }, { notes: 'use these notes instead' }]) {
    assert.equal(ok({ ...ask, ...bad }), false, JSON.stringify(bad).slice(0, 50))
  }
})

test('results: only the shapes a page shows, with nothing extra — no key, prompt, usage or id', () => {
  const explain = value => explainResultSchema.safeParse(value).success
  assert.ok(explain({ status: 'explained', text: 'B is right.', topic: { number: 3, title: 'Demand' } }))
  assert.ok(explain({ status: 'explained', text: 'B is right.', topic: null }))
  assert.ok(explain({ status: 'not-covered' }))
  assert.ok(explain({ status: 'check-failed', topic: null }))
  assert.ok(explain({ status: 'limit', limit: 'pass', resetsAt: null }))
  assert.ok(explain({ status: 'not-entitled', notice: 'plan' }))
  assert.ok(explain({ status: 'locked', plansOnSale: false }))
  for (const leak of [{ status: 'explained', text: 'B.', topic: null, correctOption: 1 }, { status: 'explained', text: 'B.', topic: null, usage: {} },
    { status: 'explained', text: 'B.', topic: { number: 3, title: 'Demand', item_id: A } }, { status: 'not-covered', prompt: 'x' },
    { status: 'explained', text: '', topic: null }, { status: 'not-entitled', notice: 'free-month' }, { status: 'answered', text: 'x', inNotes: true }]) {
    assert.equal(explain(leak), false, JSON.stringify(leak).slice(0, 60))
  }
  const ask = value => askResultSchema.safeParse(value).success
  assert.ok(ask({ status: 'answered', text: 'Your notes say so.', inNotes: false }))
  assert.equal(ask({ status: 'answered', text: 'x', inNotes: true, passages: [] }), false)
  assert.equal(ask({ status: 'explained', text: 'x', topic: null }), false)
  for (const status of ['busy', 'in-progress', 'exam-open', 'disabled', 'failed', 'not-found', 'signed-out', 'session-changed',
    'invalid-request', 'unavailable']) {
    assert.ok(explain({ status }) && ask({ status }), status)
    assert.equal(ask({ status, detail: 'x' }), false)
  }
})

const LOCAL = { NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', CAMPUS_BOT_FAKE_PROVIDER: 'true' }

test('the stand-in provider exists only on a verified local machine; everywhere else the variable does nothing', () => {
  assert.equal(fakeCampusBotProviderAllowed(LOCAL), true)
  for (const env of [{ ...LOCAL, NODE_ENV: 'production' }, { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' },
    { ...LOCAL, VERCEL_ENV: 'preview' }, { ...LOCAL, VERCEL_ENV: 'production' }, { ...LOCAL, CAMPUS_BOT_FAKE_PROVIDER: '1' },
    { ...LOCAL, CAMPUS_BOT_FAKE_PROVIDER: undefined }, { ...LOCAL, NODE_ENV: undefined }]) {
    assert.equal(fakeCampusBotProviderAllowed(env), false, JSON.stringify(env))
    assert.equal(campusBotProvider(env), null, 'and with Campus Bot not configured, there is no provider at all')
  }
  assert.notEqual(campusBotProvider(LOCAL), null)
  // The real adapter, when Campus Bot is configured and the stand-in is not allowed.
  const real = campusBotProvider({ NODE_ENV: 'production', AI_PRACTICE_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test-not-a-key' })
  assert.equal(real.id, 'anthropic')
})

test('the stand-in follows its script file, read on every call, and never leaves the machine', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'campus-bot-fake-')), 'script.json')
  const provider = campusBotProvider({ ...LOCAL, CAMPUS_BOT_FAKE_SCRIPT: file })
  const request = keys => ({ system: 's', user: '<passage id="N2" topic="t" heading="h">\nx\n</passage>\nOfficial correct option: C',
    outputSchema: { required: keys }, maxOutputTokens: 800, model: 'claude-haiku-5-5', signal: new AbortController().signal })
  const explained = await provider.generate(request(['supported', 'passage', 'explanation']))
  assert.deepEqual([explained.kind, JSON.parse(explained.text).passage, explained.model], ['completed', 'N2', 'claude-haiku-5-5'])
  assert.match(JSON.parse(explained.text).explanation, /^Option C is right/)
  fs.writeFileSync(file, JSON.stringify({ explain: 'not-covered', check: 'fail', chat: 'outside' }))
  assert.equal(JSON.parse((await provider.generate(request(['supported', 'passage', 'explanation']))).text).supported, false)
  assert.equal(JSON.parse((await provider.generate(request(['verdict']))).text).verdict, 'fail')
  assert.equal(JSON.parse((await provider.generate(request(['inNotes', 'reply']))).text).inNotes, false)
  fs.writeFileSync(file, JSON.stringify({ chat: 'timeout', explain: 'refused' }))
  await assert.rejects(provider.generate(request(['inNotes', 'reply'])), error => error instanceof ProviderError && error.code === 'timeout')
  assert.equal((await provider.generate(request(['supported', 'passage', 'explanation']))).kind, 'refused')
  fs.writeFileSync(file, 'not json')
  assert.equal((await provider.generate(request(['verdict']))).kind, 'completed', 'an unreadable script means the plain reply')
})

test('one call shape for every Campus Bot reply: the admitted model and cap, its effort, and every outcome a value', async () => {
  const seen = []
  const scripted = mode => { const fake = createFakeCampusBotProvider(() => ({ chat: mode }))
    return { id: fake.id, model: fake.model, generate: request => { seen.push(request); return fake.generate(request) } } }
  const call = (mode, limits = { model: 'claude-haiku-5-5', maxOutputTokens: 800 }) => callCampusBotModel(scripted(mode),
    { system: 's', user: 'u', outputSchema: { required: ['inNotes', 'reply'] }, limits, effort: 'low', timeoutMs: 5000 })
  const done = await call('ok')
  assert.equal(done.kind, 'completed')
  assert.equal(done.json.inNotes, true)
  assert.deepEqual([done.usage.provider, done.usage.model, done.usage.inputTokens, done.usage.outputTokens, done.usage.estimatedCostUsd],
    ['anthropic', 'claude-haiku-5-5', 6000, 350, 0.000775])
  assert.deepEqual([seen[0].model, seen[0].maxOutputTokens, seen[0].effort], ['claude-haiku-5-5', 800, 'low'])
  assert.equal((await call('refused')).kind, 'refused')
  assert.equal((await call('invalid')).kind, 'invalid')
  assert.deepEqual([(await call('timeout')).kind, (await call('timeout')).code], ['failed', 'timeout'])
  // A model this build has no price for is never called.
  seen.length = 0
  assert.deepEqual([(await call('ok', { model: 'claude-unknown-9', maxOutputTokens: 800 })).code, seen.length], ['unsupported-model', 0])
})

test('a page offers a feature only when the team has switched it on, a reply could be written, and the read is trusted', async () => {
  const provider = createFakeCampusBotProvider()
  const client = reply => ({ rpc: async name => { assert.equal(name, 'get_campus_bot_features'); return reply } })
  assert.deepEqual(await readCampusBotFeatures(client({ data: { explain: true, ask: false, topic_sets: true }, error: null }), provider),
    { explain: true, ask: false, topicSets: true })
  const off = { explain: false, ask: false, topicSets: false }
  assert.deepEqual(await readCampusBotFeatures(client({ data: { explain: true, ask: true, topic_sets: true }, error: null }), null), off, 'no provider')
  assert.deepEqual(await readCampusBotFeatures(client({ data: null, error: { code: '42501' } }), provider), off)
  assert.deepEqual(await readCampusBotFeatures(client({ data: { explain: true }, error: null }), provider), off)
  assert.deepEqual(await readCampusBotFeatures(client({ data: { explain: true, ask: true }, error: null }), provider), off, 'a switch missing')
  assert.deepEqual(await readCampusBotFeatures(client({ data: { explain: true, ask: true, topic_sets: true, more: true }, error: null }), provider), off)
  assert.deepEqual(await readCampusBotFeatures({ rpc: async () => { throw new Error('down') } }, provider), off)
})

test('the browser posts to one route with the page’s token, and trusts only an answer of the expected shape', async () => {
  const sent = []
  const fetcher = body => async (url, init) => { sent.push({ url, init }); return { json: async () => body } }
  const explained = { status: 'explained', text: 'B is right.', topic: null }
  assert.deepEqual(await requestExplanation({ operation: 'explain', attemptId: A, questionId: B }, 'page-token', fetcher(explained)), explained)
  assert.equal(sent[0].url, '/api/campus-bot')
  assert.deepEqual([sent[0].init.method, sent[0].init.credentials, sent[0].init.cache], ['POST', 'same-origin', 'no-store'])
  assert.equal(sent[0].init.headers[AUTH_CONTINUITY_HEADER], 'page-token')
  assert.deepEqual(JSON.parse(sent[0].init.body), { operation: 'explain', attemptId: A, questionId: B })
  const unavailable = { status: 'unavailable' }
  assert.deepEqual(await requestExplanation({ operation: 'explain', attemptId: A, questionId: B }, 't',
    fetcher({ ...explained, correctOption: 1 })), unavailable, 'an answer with anything extra is not shown')
  assert.deepEqual(await requestExplanation({ operation: 'explain', attemptId: A, questionId: B }, 't',
    async () => { throw new Error('offline') }), unavailable)
  const ask = { operation: 'ask', courseSlug: 'use-of-english', itemId: A, requestId: C, message: 'Hi', history: [] }
  assert.deepEqual(await sendChatMessage(ask, 't', fetcher({ status: 'answered', text: 'Hello.', inNotes: true })),
    { status: 'answered', text: 'Hello.', inNotes: true })
  assert.deepEqual(await sendChatMessage(ask, 't', fetcher(explained)), unavailable, 'an explanation is not a chat reply')
})
