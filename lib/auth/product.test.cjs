// lib/auth/product.test.cjs — Safe auth response boundaries and confirmation flow contracts.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED } = require('./constants.ts')
const { authError } = require('./response.ts')
const { AuthRequestError, readAuthRequest } = require('./request.ts')
const { mapAuthFailure, safeAuthMessage } = require('./errors.ts')
const { logoutSchema } = require('./schemas.ts')

async function invoke(route, providerError, failConfiguration = false) {
  const original = Module._load
  const file = require.resolve('../../app/api/auth/' + route + '/route.ts')
  const mocks = {
    '@/lib/auth/recovery-grant': { discardRecoveryGrant: async () => {}, clearRecoveryCookie: () => {} },
    '@/lib/auth/student-state': { rejectExistingStudent: async () => null },
    '@/lib/auth/request': { readAuthRequest: async () => ({ email: 'student@example.test', password: 'test-password' }), getRequesterAddress: () => 'local' },
    '@/lib/auth/rate-limit': { consumeAuthLimit: async () => { if (failConfiguration) throw new Error('missing configuration SQL RPC database secret') } },
    '@/lib/supabase/auth-gateway': { getAuthGateway: () => ({
      signInWithPassword: async () => ({ data: { session: null }, error: providerError }),
      resend: async () => ({ data: { user: null, session: null }, error: route === 'login' ? null : providerError }),
    }) },
  }
  try {
    Module._load = function(name, ...args) { return mocks[name] || original.call(this, name, ...args) }
    delete require.cache[file]
    const response = await require(file).POST(new Request('http://localhost'))
    return { status: response.status, body: await response.json() }
  } finally { Module._load = original; delete require.cache[file] }
}

test('configuration and raw provider/database exceptions share one safe response', async () => {
  for (const error of [new Error('Supabase SQL RPC database service role'), new AuthRequestError(500, 'raw stack trace')]) {
    const response = authError(error)
    assert.deepEqual(await response.json(), { error: AUTH_MESSAGES.unavailable })
  }
  assert.equal(safeAuthMessage('Supabase internal exception'), AUTH_MESSAGES.unavailable)
  assert.deepEqual(await invoke('login', null, true), { status: 503, body: { error: AUTH_MESSAGES.unavailable } })
  assert.deepEqual(await invoke('login', { code: 'unexpected_failure', message: 'SQL error' }), { status: 503, body: { error: AUTH_MESSAGES.unavailable } })
})
test('invalid credentials remain generic; only explicit unconfirmed result enters flow', async () => {
  assert.deepEqual(await invoke('login', { code: 'invalid_credentials', message: 'private detail' }), { status: 400, body: { error: AUTH_MESSAGES.credentials } })
  assert.deepEqual(await invoke('login', { code: 'email_not_confirmed', message: 'private detail' }), { status: 200, body: { code: EMAIL_CONFIRMATION_REQUIRED } })
  assert.equal(mapAuthFailure({ message: 'email_not_confirmed' }, 'login').status, 503)
})
test('resend accepts only a sent or recently usable code; explicit account outcomes fail safely', async () => {
  const expected = { status: 200, body: { message: AUTH_MESSAGES.email } }
  for (const error of [null, { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 9 seconds.' }]) {
    assert.deepEqual(await invoke('resend-confirmation', error), expected)
  }
  for (const error of [{ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }, { code: 'over_request_rate_limit' }]) {
    assert.deepEqual(await invoke('resend-confirmation', error), { status: 429, body: { error: AUTH_MESSAGES.limited } })
  }
  for (const error of [{ code: 'user_not_found' }, { code: 'email_exists' }, { code: 'user_already_exists' },
    { code: 'unexpected_failure', message: 'database error' }]) {
    assert.deepEqual(await invoke('resend-confirmation', error), { status: 503, body: { error: AUTH_MESSAGES.unavailable } })
  }
})
test('disabled rollout returns intentional product copy before configuration access', async () => {
  const previous = process.env.STUDENT_AUTH_ENABLED
  try {
    process.env.STUDENT_AUTH_ENABLED = 'false'
    try { await readAuthRequest(new Request('http://localhost'), logoutSchema); assert.fail('must reject') }
    catch (error) { assert.deepEqual(await authError(error).json(), { error: 'Student accounts are coming soon.' }) }
  } finally { if (previous === undefined) delete process.env.STUDENT_AUTH_ENABLED; else process.env.STUDENT_AUTH_ENABLED = previous }
})
