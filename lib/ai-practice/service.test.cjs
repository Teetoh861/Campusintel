// lib/ai-practice/service.test.cjs — Every generation outcome, driven by mocked provider replies.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AI_PRACTICE_LIMITS, AI_PRACTICE_PROMPT_VERSION } = require('./contract.ts')
const { EMPTY_PROVIDER_DIAGNOSTIC, ProviderError } = require('./provider.ts')
const { generatePracticeSet } = require('./service.ts')
const { FIXTURE_USAGE, createFixtureProvider, fixtureText } = require('./fixtures/fixture-provider.cjs')

const reply = () => JSON.parse(fixtureText('marketing-mix.response.json'))
const request = (overrides = {}) => ({
  course: { courseId: 'demo-principles-of-marketing', code: 'DEMO 201', title: 'Principles of Marketing' },
  source: { documentId: '7c1d2f3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', fileName: 'week-3-notes.txt',
    extractedText: fixtureText('marketing-mix-notes.txt') },
  questionCount: 5,
  ...overrides,
})
const clock = () => { let tick = Date.UTC(2026, 9, 16, 9, 0, 0); return () => (tick += 1500) }
const run = (provider, input = request()) => generatePracticeSet(input, { provider, timeoutMs: 5_000, now: clock() })

test('a grounded reply becomes a personal, unverified set with usage and cost', async () => {
  const provider = createFixtureProvider(reply())
  const outcome = await run(provider)
  assert.equal(outcome.status, 'generated')
  const { set, usage } = outcome
  assert.equal(set.origin, 'ai-generated')
  assert.equal(set.visibility, 'personal')
  assert.equal(set.verification, 'unverified')
  assert.equal(set.questions.length, 5)
  assert.equal(set.generation.rejectedQuestionCount, 1)
  assert.equal(set.generation.promptVersion, AI_PRACTICE_PROMPT_VERSION)
  assert.equal(set.generation.confidence, 'high')
  assert.equal(set.source.passageCount, 3)
  assert.deepEqual({ ...usage, estimatedCostUsd: undefined, durationMs: undefined }, {
    provider: 'anthropic', model: 'claude-opus-5-5', ...FIXTURE_USAGE, estimatedCostUsd: undefined, durationMs: undefined })
  // 1,450 input at $4/M plus 2,300 output at $20/M.
  assert.equal(usage.estimatedCostUsd, 0.0518)
  assert.equal(usage.durationMs, 1500)
  for (const question of set.questions) assert.equal(question.grounding.sourceSha256, set.source.sha256)
})

test('the provider receives bounded, delimited, provider-neutral input', async () => {
  const provider = createFixtureProvider(reply())
  await run(provider)
  const [call] = provider.calls
  assert.equal(call.maxOutputTokens, AI_PRACTICE_LIMITS.maxOutputTokens)
  assert.ok(call.signal instanceof AbortSignal)
  assert.match(call.system, /untrusted text supplied by the student/)
  assert.match(call.user, /^Course: DEMO 201 - Principles of Marketing\nWrite up to 5 practice questions/)
  assert.match(call.user, /<passage id="P1">[\s\S]*<\/source_material>$/)
  assert.equal(call.outputSchema.additionalProperties, false)
})

test('invalid requests never reach the provider', async () => {
  const provider = createFixtureProvider(reply())
  for (const input of [null, request({ questionCount: 0 }), request({ questionCount: 6 }),
    request({ extra: true }), request({ source: { ...request().source, documentId: 'not-a-uuid' } })]) {
    assert.deepEqual(await run(provider, input), { status: 'failed', reason: 'invalid-request', usage: null })
  }
  assert.equal(provider.calls.length, 0)
})

test('short and oversized material is rejected before any spend', async () => {
  const provider = createFixtureProvider(reply())
  const short = request({ source: { ...request().source, extractedText: 'Marketing mix: 4Ps.' } })
  const large = request({ source: { ...request().source, extractedText: 'x '.repeat(40_000) } })
  assert.deepEqual(await run(provider, short), { status: 'insufficient-source', reason: 'too-short', usage: null })
  assert.deepEqual(await run(provider, large), { status: 'insufficient-source', reason: 'too-large', usage: null })
  assert.equal(provider.calls.length, 0)
})

test('a missing provider reports not-configured instead of switching vendors', async () => {
  assert.deepEqual(await run(null), { status: 'failed', reason: 'not-configured', usage: null })
})

test('model assessments flag unsafe or unrelated material and refuse thin material', async () => {
  const assess = changes => createFixtureProvider({ ...reply(), assessment: { ...reply().assessment, ...changes } })
  assert.equal((await run(assess({ appropriate: false }))).reason, 'inappropriate')
  assert.equal((await run(assess({ relatedToCourse: false }))).reason, 'unrelated-to-course')
  const thin = await run(assess({ sufficientMaterial: false }))
  assert.deepEqual([thin.status, thin.reason], ['insufficient-source', 'low-confidence'])
  const low = await run(assess({ confidence: 'low' }))
  assert.deepEqual([low.status, low.reason], ['insufficient-source', 'low-confidence'])
  assert.equal(low.usage.inputTokens, FIXTURE_USAGE.inputTokens)
})

test('refusals are flagged for review and truncation fails safely, both with usage', async () => {
  const refused = await run(createFixtureProvider(null, { kind: 'refused' }))
  assert.deepEqual([refused.status, refused.reason], ['flagged-for-review', 'provider-refusal'])
  assert.ok(refused.usage.estimatedCostUsd > 0)
  const truncated = await run(createFixtureProvider(null, { kind: 'truncated' }))
  assert.deepEqual([truncated.status, truncated.reason], ['failed', 'truncated-output'])
})

test('unsupported replies fail as invalid output', async () => {
  for (const bad of ['not json', '{}', JSON.stringify({ ...reply(), extra: 1 }),
    JSON.stringify({ ...reply(), questions: reply().questions.slice(2, 3) })]) {
    const outcome = await run(createFixtureProvider(bad))
    assert.deepEqual([outcome.status, outcome.reason], ['failed', 'invalid-output'])
  }
})

test('fewer than half the requested questions surviving validation is a failure', async () => {
  const two = { ...reply(), questions: reply().questions.slice(0, 2) }
  assert.equal((await run(createFixtureProvider(two))).reason, 'invalid-output')
  const grounded = reply().questions.filter((_, index) => index !== 2).slice(0, 3)
  assert.equal((await run(createFixtureProvider({ ...reply(), questions: grounded }))).status, 'generated')
})

test('provider errors map to safe failure reasons and keep the private diagnostic', async () => {
  const expected = { timeout: 'timeout', 'rate-limited': 'rate-limited', overloaded: 'provider-unavailable',
    'server-error': 'provider-unavailable', transport: 'provider-unavailable', authentication: 'provider-unavailable',
    permission: 'provider-unavailable', billing: 'provider-unavailable', 'invalid-request': 'provider-unavailable',
    'unsupported-model': 'provider-unavailable', internal: 'provider-unavailable' }
  const diagnostic = { httpStatus: 401, errorType: 'authentication_error', requestId: 'req_1', transportCode: null }
  for (const [code, reason] of Object.entries(expected)) {
    const outcome = await run(createFixtureProvider(null, { error: new ProviderError(code, diagnostic) }))
    assert.deepEqual(outcome, { status: 'failed', reason, usage: null, providerError: code, providerDiagnostic: diagnostic })
  }
  const unknown = await run(createFixtureProvider(null, { error: new Error('socket closed: secret detail') }))
  assert.deepEqual(unknown, { status: 'failed', reason: 'provider-unavailable', usage: null, providerError: 'internal',
    providerDiagnostic: EMPTY_PROVIDER_DIAGNOSTIC })
  assert.ok(!JSON.stringify(unknown).includes('secret detail'))
})

test('an unpriced serving model reports null cost instead of a guess', async () => {
  const outcome = await run(createFixtureProvider(reply(), { model: 'claude-future-model' }))
  assert.equal(outcome.status, 'generated')
  assert.equal(outcome.usage.estimatedCostUsd, null)
})

test('outcomes never echo source text or prompts', async () => {
  for (const provider of [createFixtureProvider(reply()), createFixtureProvider(null, { kind: 'refused' })]) {
    const serialized = JSON.stringify(await run(provider))
    assert.ok(!serialized.includes('untrusted text supplied'))
    assert.ok(!serialized.includes('Services differ from goods because they are intangible'))
  }
})
