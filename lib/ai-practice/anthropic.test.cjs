// lib/ai-practice/anthropic.test.cjs — Claude adapter wire shape, outcomes, error mapping and secret handling.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Anthropic = require('@anthropic-ai/sdk').default
const { createAnthropicProvider } = require('./anthropic.ts')
const { createConfiguredProvider, readAiPracticeConfig, DEFAULT_ANTHROPIC_MODEL } = require('./config.ts')
const { worstCaseCostUsd } = require('./pricing.ts')
const { formatProviderDiagnostic } = require('./provider.ts')

const FAKE_KEY = 'sk-ant-test-not-a-real-key'
const request = () => ({ system: 'SYSTEM', user: 'USER', outputSchema: { type: 'object' },
  maxOutputTokens: 16000, signal: new AbortController().signal })
const message = (overrides = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  stop_sequence: null, stop_details: null,
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{"ok":', citations: null },
    { type: 'text', text: 'true}', citations: null }],
  usage: { input_tokens: 1200, output_tokens: 900, cache_read_input_tokens: null, cache_creation_input_tokens: null },
  ...overrides,
})
const fakeClient = respond => {
  const calls = []
  return { calls, messages: { async create(body, options) { calls.push({ body, options }); return respond() } } }
}

test('the request uses the Messages API with structured output and the service signal', async () => {
  const client = fakeClient(() => message())
  const provider = createAnthropicProvider({ model: 'claude-opus-5-5', timeoutMs: 1000, client })
  const req = request()
  const response = await provider.generate(req)
  assert.deepEqual(response, { kind: 'completed', text: '{"ok":true}', model: 'claude-opus-5-5',
    usage: { inputTokens: 1200, outputTokens: 900, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })
  const [{ body, options }] = client.calls
  assert.deepEqual(body, {
    model: 'claude-opus-5-5', max_tokens: 16000, system: 'SYSTEM',
    messages: [{ role: 'user', content: 'USER' }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } },
  })
  assert.equal(options.signal, req.signal)
})

test('refusal and non-final stop reasons are reported, not parsed', async () => {
  for (const [stop, kind] of [['refusal', 'refused'], ['max_tokens', 'truncated'],
    ['model_context_window_exceeded', 'truncated'], ['pause_turn', 'truncated']]) {
    const provider = createAnthropicProvider({ model: 'claude-opus-5-5', timeoutMs: 1000,
      client: fakeClient(() => message({ stop_reason: stop })) })
    const response = await provider.generate(request())
    assert.equal(response.kind, kind)
    assert.equal(response.usage.outputTokens, 900)
    assert.equal('text' in response, false)
  }
})

test('SDK errors map to provider-neutral codes without vendor messages', async () => {
  const headers = new Headers({ 'request-id': 'req_011CTest' })
  const body = type => ({ type: 'error', error: { type, message: `vendor detail ${FAKE_KEY}` } })
  const cases = [
    [new Anthropic.RateLimitError(429, body('rate_limit_error'), 'slow down', headers, 'rate_limit_error'), 'rate-limited'],
    [new Anthropic.AuthenticationError(401, {}, `bad key ${FAKE_KEY}`, headers), 'authentication'],
    [new Anthropic.PermissionDeniedError(403, {}, 'denied', headers), 'permission'],
    [new Anthropic.BadRequestError(400, {}, 'bad', headers), 'invalid-request'],
    [new Anthropic.BadRequestError(400, body('billing_error'), 'credit', headers, 'billing_error'), 'billing'],
    [new Anthropic.UnprocessableEntityError(422, {}, 'bad', headers), 'invalid-request'],
    [new Anthropic.NotFoundError(404, {}, 'missing model', headers), 'unsupported-model'],
    [new Anthropic.InternalServerError(529, {}, 'overloaded', headers), 'overloaded'],
    [new Anthropic.InternalServerError(500, {}, 'oops', headers), 'server-error'],
    [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    [new Anthropic.APIUserAbortError(), 'timeout'],
    [new Anthropic.APIConnectionError({ message: 'reset' }), 'transport'],
    [new Error('anything else'), 'internal'],
  ]
  for (const [error, code] of cases) {
    const provider = createAnthropicProvider({ model: 'claude-opus-5-5', timeoutMs: 1000,
      client: fakeClient(() => { throw error }) })
    await assert.rejects(provider.generate(request()), thrown => {
      assert.equal(thrown.name, 'ProviderError')
      assert.equal(thrown.code, code, code)
      assert.ok(!thrown.message.includes(FAKE_KEY))
      assert.ok(!JSON.stringify(thrown.diagnostic).includes(FAKE_KEY))
      return true
    })
  }
})

/** Drive the real SDK client against a stubbed HTTP reply, as a live failure would arrive. */
async function classifyHttp(status, errorBody, extraHeaders = {}) {
  const fetchStub = async () => new Response(JSON.stringify(errorBody), { status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_011CDiag', ...extraHeaders } })
  const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: 'https://api.test.invalid', fetch: fetchStub, maxRetries: 0 })
  const provider = createAnthropicProvider({ model: 'claude-sonnet-5-5', timeoutMs: 1000, client })
  try { await provider.generate(request()) } catch (error) { return error }
  throw new Error('expected a failure')
}

test('live HTTP failures are classified with a private, secret-free diagnostic', async () => {
  const error = (type, message) => ({ type: 'error', error: { type, message } })
  const cases = [
    [401, error('authentication_error', `invalid x-api-key ${FAKE_KEY}`), 'authentication'],
    [403, error('permission_error', 'not allowed'), 'permission'],
    [400, error('invalid_request_error', 'output_config: bad'), 'invalid-request'],
    [400, error('billing_error', 'credit balance too low'), 'billing'],
    [404, error('not_found_error', 'model: claude-sonnet-5-5'), 'unsupported-model'],
    [429, error('rate_limit_error', 'slow'), 'rate-limited'],
    [529, error('overloaded_error', 'busy'), 'overloaded'],
    [500, error('api_error', 'internal'), 'server-error'],
  ]
  for (const [status, body, code] of cases) {
    const thrown = await classifyHttp(status, body)
    assert.equal(thrown.code, code, `${status} ${code}`)
    assert.deepEqual(thrown.diagnostic, { httpStatus: status, errorType: body.error.type, requestId: 'req_011CDiag',
      transportCode: null })
    assert.ok(!JSON.stringify(thrown.diagnostic).includes(FAKE_KEY) && !thrown.message.includes(FAKE_KEY))
  }
  const odd = await classifyHttp(400, error('<script>', 'x'), { 'request-id': 'bad id with spaces' })
  assert.deepEqual([odd.diagnostic.errorType, odd.diagnostic.requestId], [null, null], 'unknown values are dropped')
})

test('transport failures keep only the Node error code', async () => {
  const fetchStub = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${FAKE_KEY}`),
    { code: 'ENOTFOUND' }) }) }
  const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: 'https://api.test.invalid', fetch: fetchStub, maxRetries: 0 })
  const provider = createAnthropicProvider({ model: 'claude-sonnet-5-5', timeoutMs: 1000, client })
  await assert.rejects(provider.generate(request()), thrown => {
    assert.equal(thrown.code, 'transport')
    assert.deepEqual(thrown.diagnostic, { httpStatus: null, errorType: null, requestId: null, transportCode: 'ENOTFOUND' })
    return true
  })
  assert.equal(formatProviderDiagnostic('transport', { httpStatus: null, errorType: null, requestId: null,
    transportCode: 'ENOTFOUND' }), 'code=transport status=- type=- request_id=- transport=ENOTFOUND')
})

test('the real SDK client sends the key only as a header and the body as structured output', async () => {
  const seen = []
  const fetchStub = async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
    return new Response(JSON.stringify(message()), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: 'https://api.test.invalid', fetch: fetchStub, maxRetries: 0 })
  const provider = createAnthropicProvider({ model: 'claude-opus-5-5', timeoutMs: 1000, client })
  const response = await provider.generate(request())
  assert.equal(response.kind, 'completed')
  const [call] = seen
  assert.equal(call.url, 'https://api.test.invalid/v1/messages')
  assert.equal(call.headers.get('x-api-key'), FAKE_KEY)
  assert.ok(!JSON.stringify(call.body).includes(FAKE_KEY))
  assert.deepEqual(call.body.output_config, { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } })
  assert.equal(call.body.thinking, undefined)
})

test('configuration is off by default and never falls back to another provider', () => {
  assert.deepEqual(readAiPracticeConfig({}), { status: 'disabled', reason: 'feature-off' })
  assert.deepEqual(readAiPracticeConfig({ ANTHROPIC_API_KEY: FAKE_KEY }), { status: 'disabled', reason: 'feature-off' })
  const on = { AI_PRACTICE_ENABLED: 'true' }
  assert.deepEqual(readAiPracticeConfig(on), { status: 'disabled', reason: 'missing-credential' })
  assert.deepEqual(readAiPracticeConfig({ ...on, NEXT_PUBLIC_ANTHROPIC_API_KEY: FAKE_KEY }),
    { status: 'disabled', reason: 'missing-credential' })
  assert.deepEqual(readAiPracticeConfig({ ...on, AI_PRACTICE_PROVIDER: 'openai', ANTHROPIC_API_KEY: FAKE_KEY,
    OPENAI_API_KEY: 'sk-test' }), { status: 'disabled', reason: 'unsupported-provider' })
  assert.deepEqual(readAiPracticeConfig({ ...on, ANTHROPIC_API_KEY: FAKE_KEY, AI_PRACTICE_ANTHROPIC_MODEL: 'gpt-x' }),
    { status: 'disabled', reason: 'unsupported-model' })
  const enabled = readAiPracticeConfig({ ...on, ANTHROPIC_API_KEY: FAKE_KEY, AI_PRACTICE_TIMEOUT_MS: '999999' })
  assert.deepEqual({ ...enabled, apiKey: '[present]' }, { status: 'enabled', provider: 'anthropic',
    model: DEFAULT_ANTHROPIC_MODEL, timeoutMs: 120000, apiKey: '[present]' })
  assert.equal(createConfiguredProvider({ status: 'disabled', reason: 'feature-off' }), null)
  const provider = createConfiguredProvider(enabled)
  assert.deepEqual([provider.id, provider.model], ['anthropic', 'claude-sonnet-5-5'])
  const opus = readAiPracticeConfig({ ...on, ANTHROPIC_API_KEY: FAKE_KEY, AI_PRACTICE_ANTHROPIC_MODEL: 'claude-opus-5-5' })
  assert.equal(opus.model, 'claude-opus-5-5')
  assert.ok(!JSON.stringify(provider).includes(FAKE_KEY))
})

test('the worst-case cost of one request is bounded and known for every priced model', () => {
  // 18K input and 8K output tokens: Sonnet 5.5 at $2/$10, Opus 5.5 at $4/$20 per million.
  assert.equal(worstCaseCostUsd('claude-sonnet-5-5'), 0.116)
  assert.equal(worstCaseCostUsd('claude-opus-5-5'), 0.232)
  assert.equal(worstCaseCostUsd('unknown'), null)
})

test('no client-reachable code or public variable references the AI credential or server modules', () => {
  const root = path.resolve(__dirname, '../..')
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mjs|cjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ['app', 'components', 'hooks', 'lib']) walk(path.join(root, dir))
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(!/NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|OPENAI|AI_PRACTICE)/.test(source), file)
    if (/^['"]use client['"]/m.test(source)) {
      assert.ok(!/ai-practice\/(anthropic|config|service)|@anthropic-ai\/sdk/.test(source), file)
    }
  }
  for (const file of ['anthropic.ts', 'config.ts', 'service.ts']) {
    assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'), /^import 'server-only'$/m)
  }
})
