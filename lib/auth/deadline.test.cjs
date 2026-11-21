const { test } = require('node:test')
const assert = require('node:assert/strict')
const { authDeadline, authFetch, AUTH_OUTBOUND_TIMEOUT_MS } = require('./deadline.ts')
const { getAuthGateway } = require('../supabase/auth-gateway.ts')
const { consumeAuthLimit } = require('./rate-limit.ts')
const { AuthUnavailableError } = require('./unavailable.ts')
const flush = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t, run) {
  const originalFetch = global.fetch, env = { ...process.env }
  const calls = []
  try {
    Object.assign(process.env, { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture',
      AUTH_INTERNAL_SECRET: 'fixture-hmac-material-at-least-32-bytes' })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    global.fetch = (input, init) => {
      calls.push({ input, signal: init.signal })
      return new Promise(() => {}) // deliberately ignore AbortSignal: the caller must still stop waiting
    }
    await run(calls)
  } finally {
    t.mock.timers.reset(); global.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

function isTimeout(step) {
  return error => error instanceof AuthUnavailableError && error.reason.step === 'timeout' && error.reason.code === step
}

test('each outbound call stops at exactly 10 seconds and aborts the transport', async t => fixture(t, async calls => {
  assert.equal(AUTH_OUTBOUND_TIMEOUT_MS, 10_000)
  let settled = false
  const pending = authDeadline(() => authFetch('http://127.0.0.1:9/auth/v1/user'), 'identity')
  pending.then(() => { settled = true }, () => { settled = true })
  await flush()
  t.mock.timers.tick(9_999); await flush()
  assert.equal(settled, false)
  t.mock.timers.tick(1)
  await assert.rejects(pending, isTimeout('identity'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, true)
}))

test('the real Auth gateway preserves a timeout even when the SDK would wrap/retry a fetch error', async t => fixture(t, async calls => {
  const pending = getAuthGateway('unknown').signUp({ email: 'student@example.test', password: 'fixture-password' })
  await flush()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(10_000)
  await assert.rejects(pending, isTimeout('provider'))
  assert.equal(calls[0].signal.aborted, true)
  await flush()
  assert.equal(calls.length, 1, 'the timed-out mutation was not replayed')
}))

test('the real rate-limit RPC times out at 10 seconds with its own category', async t => fixture(t, async calls => {
  const pending = consumeAuthLimit('REGISTER', 'student@example.test', 'unknown')
  await flush()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(10_000)
  await assert.rejects(pending, isTimeout('rate-limit'))
  assert.equal(calls[0].signal.aborted, true)
}))

test('the outbound deadline covers a stalled response body, not only headers', async t => fixture(t, async () => {
  let stream
  global.fetch = async () => new Response(new ReadableStream({ start(controller) { stream = controller } }))
  const pending = authFetch('http://127.0.0.1:9/auth/v1/user')
  await flush()
  t.mock.timers.tick(10_000)
  await assert.rejects(pending, isTimeout('provider'))
  stream.close()
}))
