// lib/auth/reset-flow.test.cjs — Grant-only password replacement and safe failure responses.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// restores: what putting the held grant back answers (true, false, or 'throws' for a store failure).
// finishFails: deleting the held grant fails; the grant then simply stays held, which no request can use.
async function runScenario({ missingGrant = false, updateError = null, throws = false, restores = true, finishFails = false } = {}) {
  const originalLoad = Module._load
  const calls = []
  const mocks = {
    'next/headers': { cookies: async () => ({ getAll: () => [] }) },
    '@/lib/auth/student-state': { rejectExistingStudent: async () => null },
    '@/lib/auth/request': { readAuthRequest: async () => ({ email: 'student@example.test', password: 'test-password' }),
      getRequesterAddress: () => 'local', AuthRequestError: class extends Error {} },
    '@/lib/auth/recovery-grant': {
      claimRecoveryGrant: async () => {
        calls.push('claim')
        return missingGrant ? null : { userId: 'test-user',
          restore: async () => {
            calls.push('restore')
            if (restores === 'throws') throw new Error('private store detail')
            return restores
          },
          finish: async () => { calls.push('finish'); if (finishFails) throw new Error('private store detail') },
        }
      },
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
    const succeeded = !missingGrant && !updateError && !throws
    // A grant that went back keeps its cookie exactly as it was: the response sets nothing.
    const restored = calls.includes('restore') && restores === true
    assert.equal(cookies.length, missingGrant || restored ? 0 : succeeded ? 2 : 1)
    const selector = response.cookies.get('ci-student-session-generation')
    if (succeeded) {
      assert.match(selector.value, /^[a-f0-9]{32}$/)
      assert.equal(selector.httpOnly, true)
    } else assert.equal(selector, undefined)
    if (!missingGrant && !restored) {
      assert.equal(cookies[0].name, 'ci-recovery-grant')
      assert.equal(cookies[0].value, ''); assert.equal(cookies[0].maxAge, 0)
      assert.equal(cookies[0].httpOnly, true); assert.equal(cookies[0].sameSite, 'lax'); assert.equal(cookies[0].path, '/api/auth')
    }
    // A held grant is restored or finished, never both and never neither.
    if (!missingGrant) assert.equal(restored, !calls.includes('finish'))
    return { response, body, calls }
  } finally { Module._load = originalLoad; delete require.cache[file] }
}

test('a password the provider refuses changes nothing: the grant goes back and the student stays on Change password', async () => {
  for (const [code, line] of [['same_password', 'Choose a different password.'], ['weak_password', 'Choose a stronger password.']]) {
    const { response, body, calls } = await runScenario({ updateError: { code, message: 'private provider detail' } })
    assert.equal(response.status, 400)
    assert.deepEqual(body, { error: line, code: 'RECOVERY_PASSWORD_REJECTED' })
    assert.deepEqual(calls, ['claim', 'replace-and-revoke', 'restore'], 'held before the provider is asked, restored only after it refuses')
  }
})
test('a refused password whose grant cannot go back (expired meanwhile, or the store failed) starts recovery again', async () => {
  for (const restores of [false, 'throws']) {
    const { response, body, calls } = await runScenario({ updateError: { code: 'weak_password' }, restores })
    assert.equal(response.status, 400)
    assert.deepEqual(body, { error: 'Request a new code to continue.', code: 'RECOVERY_RESTART_REQUIRED' })
    assert.deepEqual(calls, ['claim', 'replace-and-revoke', 'restore', 'finish'])
  }
})
test('unexpected returned or thrown password/revocation transaction failure cannot report success', async () => {
  for (const failure of [{ updateError: { code: 'unexpected', message: 'private detail' } }, { throws: true }]) {
    const { response, body, calls } = await runScenario(failure)
    assert.equal(response.status, 503)
    assert.equal(body.error, 'Something went wrong. Please try again.')
    assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
    assert.deepEqual(calls, ['claim', 'replace-and-revoke', 'finish'], 'only a refused password puts the grant back')
  }
})
test('successful replacement calls the privileged password-and-revocation operation after the grant is held, and uses it up', async () => {
  const { response, body, calls } = await runScenario()
  assert.equal(response.status, 200)
  assert.deepEqual(body, { next: '/login' })
  assert.deepEqual(calls, ['claim', 'replace-and-revoke', 'finish'], 'never restored after a change')
  // The change stands even if the used grant could not be deleted: it stays held, which nothing can use.
  const undeleted = await runScenario({ finishFails: true })
  assert.equal(undeleted.response.status, 200)
  assert.deepEqual(undeleted.body, { next: '/login' })
})
test('missing or used grant cannot update a password or create a session', async () => {
  const { response, body, calls } = await runScenario({ missingGrant: true })
  assert.equal(response.status, 400)
  assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
  assert.deepEqual(calls, ['claim'])
})

test('provider throttling after the grant is held requires a new code without reporting password success', async () => {
  const { response, body, calls } = await runScenario({ updateError: { code: 'over_request_rate_limit' } })
  assert.equal(response.status, 429)
  assert.equal(body.code, 'RECOVERY_RESTART_REQUIRED')
  assert.equal(body.error, 'Too many attempts. Please try again later.')
  assert.deepEqual(calls, ['claim', 'replace-and-revoke', 'finish'])
})
