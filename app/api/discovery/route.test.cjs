// app/api/discovery/route.test.cjs — Preview commands cross the real bounded parser, stay private and map every outcome
// to an explicit HTTP status.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

const OPEN = { action: 'open', courseSlug: 'business-statistics', kind: 'cbt' }

async function fixture(run) {
  const original = Module._load, file = require.resolve('./route.ts'), calls = []
  const state = { result: { status: 'available', endsAt: '2026-10-22T14:05:00.000Z' } }
  try {
    Module._load = function(name, ...args) {
      if (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts')) return {
        isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
      }
      if (name === '@/lib/entitlements/discovery') return { runDiscoveryRequest: async (input, response, token) => {
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
    const post = (body = OPEN, headers = {}) => POST(new Request('https://campusintell.test/api/discovery', {
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
  assert.deepEqual(f.calls, [{ input: OPEN, token: 'page-token' }])
}))

test('cross-origin, wrong content type and oversized commands never reach the service', async () => fixture(async f => {
  for (const [body, headers] of [
    [OPEN, { Origin: 'https://evil.test' }],
    [OPEN, { 'Content-Type': 'text/plain' }],
    [{ ...OPEN, padding: 'x'.repeat(9000) }, {}],
  ]) {
    const response = await f.post(body, headers)
    assert.ok(response.status >= 400, `refused with ${response.status}`)
  }
  assert.equal(f.calls.length, 0)
}))

test('each outcome has an explicit status; refusals never look like success', async () => fixture(async f => {
  for (const [status, http] of [['signed-out', 401], ['session-changed', 409], ['invalid-request', 400],
    ['not-found', 404], ['no-pass', 403], ['expired', 403], ['nothing-to-preview', 404], ['not-opened', 409],
    ['free-course', 409], ['full-access', 409], ['unavailable', 503]]) {
    f.state.result = { status }
    assert.equal((await f.post()).status, http, status)
  }
  f.state.result = { status: 'used-elsewhere', endsAt: 'x', courseCode: 'BUA203', courseSlug: 'business-statistics' }
  assert.equal((await f.post()).status, 409)
  f.state.result = { status: 'not-enough-time', now: 'x', endsAt: 'y' }
  assert.equal((await f.post()).status, 409, 'an exam that no longer fits is a refusal')
  f.state.result = { status: 'saved', now: 'x' }
  assert.equal((await f.post()).status, 200, 'a saved sheet is a success')
}))
