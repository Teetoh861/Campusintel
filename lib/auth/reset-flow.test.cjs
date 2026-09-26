// lib/auth/reset-flow.test.cjs — Grant-only password replacement and safe failure responses.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

async function runScenario({ missingGrant = false, updateError = null, throws = false } = {}) {
  const originalLoad = Module._load
  const calls = []
  const mocks = {
    '@/lib/auth/student-state': { rejectExistingStudent: async () => null },
    '@/lib/auth/request': { readAuthRequest: async () => ({ email: 'student@example.test', password: 'test-password' }),
      getRequesterAddress: () => 'local', AuthRequestError: class extends Error {} },
    '@/lib/auth/recovery-grant': {
      consumeRecoveryGrant: async () => { calls.push('consume'); return missingGrant ? null : { userId: 'test-user' } },
      clearRecoveryCookie: response => response.cookies.set('ci-recovery-grant', '', { httpOnly: true, sameSite: 'lax', path: '/api/auth', maxAge: 0 }),
    },
    '@/lib/supabase/recovery-auth': { getRecoveryAuthGateway: () => ({
      replacePasswordAndRevokeSessions: async (id, password) => {
        assert.equal(id, 'test-user'); assert.equal(password, 'test-password'); calls.push('replace-and-revoke')
        if (throws) throw new Error('private provider detail')
        return { error: updateError }
      },
    }) },
    '@/lib/supabase/server': { createClient: () => { throw new Error('Recovery must not create a student session') } },
  }
  const file = require.resolve('../../app/api/auth/reset-password/route.ts')
  try {
    Module._load = function(name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    delete require.cache[file]
    const response = await require(file).POST(new Request('http://localhost/api/auth/reset-password'))
    const body = await response.json()
    assert.doesNotMatch(JSON.stringify(body), /test-user|test-password|private|access_token|refresh_token/)
    const cookies = response.cookies.getAll()
    assert.equal(cookies.length, 1)
    assert.equal(cookies[0].name, 'ci-recovery-grant')
    assert.equal(cookies[0].value, ''); assert.equal(cookies[0].maxAge, 0)
    assert.equal(cookies[0].httpOnly, true); assert.equal(cookies[0].sameSite, 'lax'); assert.equal(cookies[0].path, '/api/auth')
    return { response, body, calls }
  } finally { Module._load = originalLoad; delete require.cache[file] }
}

test('expected password policy errors stay safe and clear the consumed grant', async () => {
  for (const code of ['same_password', 'weak_password']) {
    const { response, body } = await runScenario({ updateError: { code, message: 'private provider detail' } })
    assert.equal(response.status, 400)
    assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
    assert.match(body.error, /new recovery code/)
    assert.doesNotMatch(body.error, /already.*used/)
  }
})
test('unexpected returned or thrown password/revocation transaction failure cannot report success', async () => {
  for (const failure of [{ updateError: { code: 'unexpected', message: 'private detail' } }, { throws: true }]) {
    const { response, body } = await runScenario(failure)
    assert.equal(response.status, 503)
    assert.equal(body.error, 'Something went wrong. Please try again.')
    assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
  }
})
test('successful replacement calls the privileged password-and-revocation operation after consumption', async () => {
  const { response, body, calls } = await runScenario()
  assert.equal(response.status, 200)
  assert.deepEqual(body, { next: '/login?state=password-reset' })
  assert.deepEqual(calls, ['consume', 'replace-and-revoke'])
})
test('missing or consumed grant cannot update a password or create a session', async () => {
  const { response, body, calls } = await runScenario({ missingGrant: true })
  assert.equal(response.status, 400)
  assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
  assert.deepEqual(calls, ['consume'])
})

test('provider throttling after grant consumption requires a new code without reporting password success', async () => {
  const { response, body, calls } = await runScenario({ updateError: { code: 'over_request_rate_limit' } })
  assert.equal(response.status, 429)
  assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
  assert.equal(body.error, 'Too many attempts. Please try again later.')
  assert.deepEqual(calls, ['consume', 'replace-and-revoke'])
})
