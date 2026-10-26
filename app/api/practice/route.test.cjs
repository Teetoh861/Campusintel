// app/api/practice/route.test.cjs — Practice commands cross the real bounded parser, stay private and map every outcome
// to an explicit HTTP status.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

const ATTEMPT = { action: 'attempt', attemptId: '11111111-1111-4111-8111-111111111111' }

async function fixture(run) {
  const original = Module._load, file = require.resolve('./route.ts'), calls = []
  const state = { result: { status: 'not-found' } }
  try {
    Module._load = function(name, ...args) {
      if (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts')) return {
        isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
      }
      if (name === '@/lib/practice/server') return { runPracticeRequest: async (input, response, token) => {
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
    const post = (body = ATTEMPT, headers = {}) => POST(new Request('https://campusintell.test/api/practice', {
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
  f.state.result = { status: 'saved', now: 'x', deadlineAt: 'y', revision: 1, answers: {} }
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('set-cookie'), /HttpOnly/)
  assert.deepEqual(f.calls, [{ input: ATTEMPT, token: 'page-token' }])
}))

test('cross-origin, wrong content type and oversized commands never reach the service', async () => fixture(async f => {
  for (const [body, headers] of [
    [ATTEMPT, { Origin: 'https://evil.test' }],
    [ATTEMPT, { 'Content-Type': 'text/plain' }],
    [{ ...ATTEMPT, padding: 'x'.repeat(9000) }, {}],
  ]) {
    const response = await f.post(body, headers)
    assert.ok(response.status >= 400, `refused with ${response.status}`)
  }
  assert.equal(f.calls.length, 0)
}))

test('each outcome has an explicit status; refusals never look like success', async () => fixture(async f => {
  for (const [status, http] of [['signed-out', 401], ['session-changed', 409], ['invalid-request', 400],
    ['not-found', 404], ['conflict', 409], ['locked', 403], ['questions-changed', 409], ['unavailable', 503]]) {
    f.state.result = { status }
    assert.equal((await f.post()).status, http, status)
  }
  f.state.result = { status: 'policy-changed', questionCount: 40, durationSeconds: 1800, bankSize: 40 }
  assert.equal((await f.post()).status, 409, 'a changed brief starts nothing')
  f.state.result = { status: 'too-many-tabs', now: 'x', deadlineAt: 'y', revision: 1, answers: {} }
  assert.equal((await f.post()).status, 409)
  for (const status of ['ready', 'graded', 'in-progress', 'stale']) {
    f.state.result = { status, now: 'x' }
    assert.equal((await f.post()).status, 200, status)
  }
}))
