// lib/ai-practice/fixtures/fixture-provider.cjs — Deterministic provider for tests and the mock demo.
// It implements the same QuestionGenerationProvider interface as the real adapters and never
// touches the network. Usage numbers are illustrative, not measurements.
const fs = require('node:fs')
const path = require('node:path')

const FIXTURE_USAGE = { inputTokens: 1450, outputTokens: 2300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }

function fixtureText(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8')
}

/** Reply with a scripted response. `reply` is raw text or an object serialized as the model's JSON. */
function createFixtureProvider(reply, options = {}) {
  const calls = []
  return {
    id: options.id ?? 'anthropic',
    model: options.model ?? 'claude-opus-5-5',
    calls,
    async generate(request) {
      calls.push(request)
      if (options.error) throw options.error
      const usage = options.usage ?? FIXTURE_USAGE
      const model = options.model ?? 'claude-opus-5-5'
      if (options.kind && options.kind !== 'completed') return { kind: options.kind, model, usage }
      return { kind: 'completed', model, usage, text: typeof reply === 'string' ? reply : JSON.stringify(reply) }
    },
  }
}

module.exports = { FIXTURE_USAGE, createFixtureProvider, fixtureText }
