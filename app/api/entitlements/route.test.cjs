// app/api/entitlements/route.test.cjs — Trial commands cross the real bounded parser, stay private and
// map every service outcome to an explicit HTTP status.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

const SEND = { action: 'send-trial-code', phone: '08031234567' }

async function fixture(run) {
  const original = Module._load, file = require.resolve('./route.ts'), calls = []
  const state = { result: { status: 'trial-activated', endsAt: '2026-11-02T09:00:00.000Z' } }
  try {
    Module._load = function(name, ...args) {
      if (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts')) return {
        isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
      }
      if (name === '@/lib/entitlements/server') return { runEntitlementRequest: async (input, response, token) => {
        calls.push({ input, token })
        response.headers.set('Set-Cookie', 'refreshed-session=test; HttpOnly; Path=/')
        return state.result
      } }
      return original.call(this, name, ...args)
    }
    const requestFile = require.resolve('../../../lib/auth/request.ts')
    const previousRequest = require.cache[requestFile]
    delete require.cache[requestFile]; delete require.cache[file]
    const { POST } = require(file)
    const post = (body = SEND, headers = {}) => POST(new Request('https://campusintell.test/api/entitlements', {
      method: 'POST', headers: { Origin: 'https://campusintell.test', 'Content-Type': 'application/json',
        [AUTH_CONTINUITY_HEADER]: 'page-token', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }))
    try { await run({ post, calls, state }) } finally {
      delete require.cache[requestFile]
      if (previousRequest) require.cache[requestFile] = previousRequest
    }
  } finally { Module._load = original; delete require.cache[file] }
}

test('a same-origin command reaches the service with the page token and the response stays private', async () => fixture(async f => {
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('set-cookie'), /HttpOnly/)
  assert.deepEqual(f.calls, [{ input: SEND, token: 'page-token' }])
}))

test('cross-origin, wrong content type, malformed and oversized commands never reach the service', async () => fixture(async f => {
  for (const [body, headers, status] of [
    [SEND, { Origin: 'https://elsewhere.test' }, 403],
    [SEND, { 'sec-fetch-site': 'cross-site' }, 403],
    [SEND, { 'Content-Type': 'text/plain' }, 415],
    ['{', {}, 400],
    [{ ...SEND, padding: 'x'.repeat(600) }, {}, 413],
  ]) {
    const response = await f.post(body, headers)
    assert.equal(response.status, status, JSON.stringify(headers))
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  assert.deepEqual(f.calls, [])
}))

test('every outcome maps to an explicit private status', async () => fixture(async f => {
  for (const [result, code] of [
    [{ status: 'code-sent', challengeId: '11111111-1111-4111-8111-111111111111', phoneHint: '567', expiresAt: 'a', resendAt: 'b' }, 200],
    [{ status: 'trial-activated', endsAt: 'a' }, 200], [{ status: 'early-access-active', availableFrom: 'a' }, 409],
    [{ status: 'signed-out' }, 401], [{ status: 'session-changed' }, 409], [{ status: 'invalid-request' }, 400],
    [{ status: 'invalid-phone' }, 400], [{ status: 'unavailable' }, 503], [{ status: 'capacity' }, 503],
    [{ status: 'cooldown', retryAt: 'a' }, 429], [{ status: 'rate-limited', retryAt: 'a' }, 429],
    [{ status: 'delivery-failed', challengeId: '11111111-1111-4111-8111-111111111111', phoneHint: '567', resendAt: 'a' }, 502],
    [{ status: 'incorrect', attemptsLeft: 2 }, 422], [{ status: 'expired' }, 410], [{ status: 'superseded' }, 410],
    [{ status: 'already-used' }, 409], [{ status: 'too-many-attempts' }, 429], [{ status: 'already-activated' }, 409],
    [{ status: 'phone-already-used' }, 409], [{ status: 'trial-not-offered' }, 403],
  ]) {
    f.state.result = result
    const response = await f.post()
    assert.equal(response.status, code, result.status)
    assert.deepEqual(await response.json(), result)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
}))
