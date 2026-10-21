// app/api/entitlements/route.test.cjs — The activation command crosses the real bounded parser, carries the trusted
// requester address, stays private and maps every service outcome to an explicit HTTP status.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

const ACTIVATE = { action: 'activate-discovery-pass' }

async function fixture(run) {
  const original = Module._load, file = require.resolve('./route.ts'), calls = []
  const state = { result: { status: 'pass-activated', endsAt: '2026-10-29T09:00:00.000Z' } }
  try {
    Module._load = function(name, ...args) {
      if (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts')) return {
        isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
        getAuthOrigin: () => 'https://campusintell.test',
      }
      if (name === '@/lib/entitlements/server') return { runEntitlementRequest: async (input, response, token, address) => {
        calls.push({ input, token, address })
        response.headers.set('Set-Cookie', 'refreshed-session=test; HttpOnly; Path=/')
        return state.result
      } }
      return original.call(this, name, ...args)
    }
    const requestFile = require.resolve('../../../lib/auth/request.ts')
    const previousRequest = require.cache[requestFile]
    delete require.cache[requestFile]; delete require.cache[file]
    const { POST } = require(file)
    const post = (body = ACTIVATE, headers = {}) => POST(new Request('https://campusintell.test/api/entitlements', {
      method: 'POST', headers: { Origin: 'https://campusintell.test', 'Content-Type': 'application/json',
        [AUTH_CONTINUITY_HEADER]: 'page-token', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }))
    try { await run({ post, calls, state }) } finally {
      delete require.cache[requestFile]
      if (previousRequest) require.cache[requestFile] = previousRequest
    }
  } finally { Module._load = original; delete require.cache[file] }
}

test('a same-origin command reaches the service with the page token and requester address; the response stays private', async () => fixture(async f => {
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('set-cookie'), /HttpOnly/)
  // Outside Vercel and production the trusted address is the local bucket (lib/auth/request.ts).
  assert.deepEqual(f.calls, [{ input: ACTIVATE, token: 'page-token', address: 'local' }])
}))

test('cross-origin, wrong content type, malformed and oversized commands never reach the service', async () => fixture(async f => {
  for (const [body, headers, status] of [
    [ACTIVATE, { Origin: 'https://elsewhere.test' }, 403],
    [ACTIVATE, { 'sec-fetch-site': 'cross-site' }, 403],
    [ACTIVATE, { 'Content-Type': 'text/plain' }, 415],
    ['{', {}, 400],
    [{ ...ACTIVATE, padding: 'x'.repeat(300) }, {}, 413],
  ]) {
    const response = await f.post(body, headers)
    assert.equal(response.status, status, JSON.stringify(headers))
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  assert.deepEqual(f.calls, [])
}))

test('every outcome maps to an explicit private status', async () => fixture(async f => {
  for (const [result, code] of [
    [{ status: 'pass-activated', endsAt: 'a' }, 200], [{ status: 'already-activated', endsAt: 'a' }, 409],
    [{ status: 'early-access-active', availableFrom: 'a' }, 409], [{ status: 'already-claimed' }, 409],
    [{ status: 'signed-out' }, 401], [{ status: 'session-changed' }, 409], [{ status: 'invalid-request' }, 400],
    [{ status: 'unavailable' }, 503], [{ status: 'capacity' }, 503], [{ status: 'rate-limited' }, 429],
    [{ status: 'trial-not-offered' }, 403],
  ]) {
    f.state.result = result
    const response = await f.post()
    assert.equal(response.status, code, result.status)
    assert.deepEqual(await response.json(), result)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
}))
