// lib/ai-practice/supabase-env.test.cjs — How the begin answer is read: a token-funded start carries the model and
// written-token cap it was reserved for; Campus Bot limit refusals pass through; anything malformed is unavailable.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSupabaseAiPracticeEnv } = require('./supabase-env.ts')

const GENERATION = 'e0a1c2d3-0000-4000-8000-000000000004'
const envFor = answer => {
  const calls = []
  const service = () => ({ rpc: (fn, args) => { calls.push([fn, args]); return { abortSignal: async signal => {
    assert.ok(signal instanceof AbortSignal); return { data: answer, error: null } } } } })
  return { calls, env: createSupabaseAiPracticeEnv({}, 'user-1', 'session-1', service) }
}

test('a token-funded start carries the reserved model and cap; a counted start carries none', async () => {
  const tokens = envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 300, model: 'claude-haiku-5-5', max_output_tokens: 8000 })
  assert.deepEqual(await tokens.env.beginGeneration('req-1', 'doc-1'), { state: 'started', generationId: GENERATION,
    limits: { model: 'claude-haiku-5-5', maxOutputTokens: 8000 } })
  assert.equal(tokens.calls[0][0], 'begin_ai_practice_generation')
  assert.ok(tokens.calls[0][1].p_accepted_sources.includes('paid'))
  assert.deepEqual(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 300 }).env.beginGeneration('req-1', 'doc-1'),
    { state: 'started', generationId: GENERATION })
})

test('Campus Bot limits pass through; malformed answers are unavailable', async () => {
  for (const state of ['session-limit', 'week-limit', 'undelivered-limit']) {
    assert.deepEqual(await envFor({ state, resets_at: '2026-11-03T14:00:00Z' }).env.beginGeneration('r', 'd'),
      { state, resetsAt: '2026-11-03T14:00:00Z' })
    assert.deepEqual(await envFor({ state }).env.beginGeneration('r', 'd'), { state, resetsAt: null }, `${state} without a time`)
  }
  assert.equal(await envFor({ state: 'started' }).env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 300, model: 'gpt-x', max_output_tokens: 8000 })
    .env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 300, model: 'claude-haiku-5-5', max_output_tokens: 0 })
    .env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'something-new' }).env.beginGeneration('r', 'd'), null)
})

test('a missing or unsafe reservation never starts a live provider', async () => {
  for (const reservation_seconds of [undefined, 0, 45]) {
    assert.equal(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds })
      .env.beginGeneration('req', 'doc'), null)
  }
})

test('admission and settlement cancel transport and return by their own deadlines', async t => {
  const { AI_ADMISSION_TIMEOUT_MS, AI_SETTLEMENT_TIMEOUT_MS, AiDeadlineError } = require('./lifetime.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const signals = []
  const service = () => ({ rpc: () => ({ abortSignal: signal => {
    signals.push(signal); return new Promise(() => {})
  } }) })
  const env = createSupabaseAiPracticeEnv({}, 'user', 'session', service)
  const begun = env.beginGeneration('request', 'document')
  const refused = assert.rejects(begun, AiDeadlineError)
  await Promise.resolve(); t.mock.timers.tick(AI_ADMISSION_TIMEOUT_MS); await refused
  assert.equal(signals[0].aborted, true)
  const finished = env.finishGeneration(GENERATION, 'failed', 'timeout', null, null)
  const expired = assert.rejects(finished, AiDeadlineError)
  await Promise.resolve(); t.mock.timers.tick(AI_SETTLEMENT_TIMEOUT_MS); await expired
  assert.equal(signals[1].aborted, true)
})

test('the reservation must outlast the maximum enabled provider timeout and settlement', async () => {
  const names = ['AI_PRACTICE_ENABLED', 'AI_PRACTICE_TIMEOUT_MS', 'ANTHROPIC_API_KEY', 'AI_PRACTICE_PROVIDER', 'AI_PRACTICE_ANTHROPIC_MODEL']
  const before = names.map(name => process.env[name])
  try {
    // Local constructor only; this test never invokes the adapter or any provider.
    Object.assign(process.env, { AI_PRACTICE_ENABLED: 'true', AI_PRACTICE_TIMEOUT_MS: '120000',
      ANTHROPIC_API_KEY: 'local-unit-fixture', AI_PRACTICE_PROVIDER: 'anthropic', AI_PRACTICE_ANTHROPIC_MODEL: 'claude-haiku-5-5' })
    assert.equal(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 285 })
      .env.beginGeneration('req', 'doc'), null)
    assert.deepEqual(await envFor({ state: 'started', generation_id: GENERATION, reservation_seconds: 300 })
      .env.beginGeneration('req', 'doc'), { state: 'started', generationId: GENERATION })
  } finally {
    names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i] })
  }
})
