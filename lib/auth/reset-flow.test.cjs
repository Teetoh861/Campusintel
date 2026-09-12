// lib/auth/reset-flow.test.cjs — Execute the reset handler with isolated provider failures and cookie writes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextResponse } = require('next/server')
const { getStudentCookieOptions } = require('./cookies.ts')

async function runScenario({ updateError = null, throws = false, transferFails = false, revokeFails = false } = {}) {
  const originalLoad = Module._load
  const scopes = []
  const calls = []
  const mocks = {
    '@/lib/auth/request': {
      readAuthRequest: async () => ({ email: 'student@example.test', code: 'test-code', password: 'test-password' }),
      getRequesterAddress: () => 'local', AuthRequestError: class extends Error {},
    },
    '@/lib/auth/rate-limit': { consumeAuthLimit: async () => {} },
    '@/lib/supabase/auth-gateway': { getAuthGateway: () => ({ verifyOtp: async params => {
      assert.equal(params.type, 'recovery')
      calls.push('verify')
      return { data: { session: { access_token: 'test-access', refresh_token: 'test-refresh' }, user: { id: 'test-user' } }, error: null }
    } }) },
    '@/lib/supabase/server': { createClient: async response => ({ auth: {
      setSession: async () => {
        calls.push('transfer')
        for (const name of ['sb-test-auth-token.0', 'sb-test-auth-token.1']) {
          response.cookies.set(name, 'test-session', getStudentCookieOptions({ maxAge: 3600 }))
        }
        if (transferFails) throw new Error('private transfer detail')
        return { data: { user: { id: 'test-user' } }, error: null }
      },
      updateUser: async () => {
        calls.push('update')
        if (throws) throw new Error('private provider detail')
        return { error: updateError }
      },
      signOut: async ({ scope }) => {
        scopes.push(scope)
        if (revokeFails) throw new Error('private revocation detail')
        for (const cookie of response.cookies.getAll()) response.cookies.set({ ...cookie, value: '', maxAge: 0 })
        return { error: null }
      },
    } }) },
  }
  const file = require.resolve('../../app/api/auth/reset-password/route.ts')
  try {
    Module._load = function (name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    delete require.cache[file]
    const { POST } = require(file)
    const response = await POST(new Request('http://localhost/api/auth/reset-password'))
    assert.ok(response instanceof NextResponse)
    const body = await response.json()
    assert.doesNotMatch(JSON.stringify(body), /test-access|test-refresh|test-session|private|test-user|test-code/)
    return { response, body, scopes, calls }
  } finally { Module._load = originalLoad; delete require.cache[file] }
}

function assertCleared(response) {
  const cookies = response.cookies.getAll()
  assert.equal(cookies.length, 2)
  for (const cookie of cookies) {
    assert.equal(cookie.value, '')
    assert.equal(cookie.maxAge, 0)
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.sameSite, 'lax')
    assert.equal(cookie.path, '/')
  }
}

test('same password gives actionable safe guidance and clears recovery cookies', async () => {
  const { response, body, scopes } = await runScenario({ updateError: { code: 'same_password', message: 'private provider detail' } })
  assert.equal(response.status, 400)
  assert.match(body.error, /cannot be reused/)
  assert.match(body.error, /already been used/)
  assert.match(body.error, /new recovery code.*different password/)
  assert.deepEqual(scopes, ['local'])
  assertCleared(response)
})
test('weak password maps to safe policy guidance', async () => {
  const { response, body } = await runScenario({ updateError: { code: 'weak_password' } })
  assert.equal(response.status, 400)
  assert.match(body.error, /stronger password/)
  assertCleared(response)
})
test('unexpected returned update failure remains generic and clears cookies', async () => {
  const { response, body } = await runScenario({ updateError: { code: 'unexpected', message: 'private detail' } })
  assert.equal(response.status, 503)
  assert.equal(body.error, 'Password reset could not be completed. Request a new code and try again.')
  assertCleared(response)
})
test('thrown update and transfer failures still revoke locally and clear staged cookies', async () => {
  for (const scenario of [{ throws: true }, { transferFails: true }]) {
    const { response, scopes } = await runScenario(scenario)
    assert.equal(response.status, 503)
    assert.deepEqual(scopes, ['local'])
    assertCleared(response)
  }
})
test('successful update globally revokes before returning the login destination', async () => {
  const { response, body, scopes, calls } = await runScenario()
  assert.equal(response.status, 200)
  assert.deepEqual(body, { next: '/login?state=password-reset' })
  assert.deepEqual(scopes, ['global'])
  assert.deepEqual(calls, ['verify', 'transfer', 'update'])
  assertCleared(response)
})
test('global revocation failure never reports success or releases recovery cookies', async () => {
  const { response, scopes } = await runScenario({ revokeFails: true })
  assert.equal(response.status, 503)
  assert.deepEqual(scopes, ['global', 'global'])
  assertCleared(response)
})
