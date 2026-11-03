// lib/ai-practice/supabase-env.test.cjs — How the begin answer is read: a token-funded start carries the model and
// written-token cap it was reserved for; Campus Bot limit refusals pass through; anything malformed is unavailable.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSupabaseAiPracticeEnv } = require('./supabase-env.ts')

const GENERATION = 'e0a1c2d3-0000-4000-8000-000000000004'
const envFor = answer => {
  const calls = []
  const service = () => ({ rpc: async (fn, args) => { calls.push([fn, args]); return { data: answer, error: null } } })
  return { calls, env: createSupabaseAiPracticeEnv({}, 'user-1', 'session-1', service) }
}

test('a token-funded start carries the reserved model and cap; a counted start carries none', async () => {
  const tokens = envFor({ state: 'started', generation_id: GENERATION, model: 'claude-haiku-5-5', max_output_tokens: 8000 })
  assert.deepEqual(await tokens.env.beginGeneration('req-1', 'doc-1'), { state: 'started', generationId: GENERATION,
    limits: { model: 'claude-haiku-5-5', maxOutputTokens: 8000 } })
  assert.equal(tokens.calls[0][0], 'begin_ai_practice_generation')
  assert.ok(tokens.calls[0][1].p_accepted_sources.includes('paid'))
  assert.deepEqual(await envFor({ state: 'started', generation_id: GENERATION }).env.beginGeneration('req-1', 'doc-1'),
    { state: 'started', generationId: GENERATION })
})

test('Campus Bot limits pass through; malformed answers are unavailable', async () => {
  for (const state of ['session-limit', 'week-limit', 'undelivered-limit']) {
    assert.deepEqual(await envFor({ state, resets_at: '2026-11-03T14:00:00Z' }).env.beginGeneration('r', 'd'), { state })
  }
  assert.equal(await envFor({ state: 'started' }).env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'started', generation_id: GENERATION, model: 'gpt-x', max_output_tokens: 8000 })
    .env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'started', generation_id: GENERATION, model: 'claude-haiku-5-5', max_output_tokens: 0 })
    .env.beginGeneration('r', 'd'), null)
  assert.equal(await envFor({ state: 'something-new' }).env.beginGeneration('r', 'd'), null)
})
