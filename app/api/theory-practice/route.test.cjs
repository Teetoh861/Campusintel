const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { command, feedback, longDraft } = require('../../../lib/theory-practice/fixtures.cjs')
const { THEORY_BODY_MAX_BYTES } = require('../../../lib/theory-practice/contract.ts')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

async function fixture(run) {
  const original = Module._load, file = require.resolve('./route.ts'), calls = []
  const state = { result: { status: 'ready', feedback } }
  try {
    Module._load = function(name, ...args) {
      if (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts')) return {
        isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
      }
      if (name === '@/lib/theory-practice/submit') return { submitTheoryAnswer: async (input, response, token) => {
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
    const post = (body = command(), headers = {}) => POST(new Request('https://campusintell.test/api/theory-practice', {
      method: 'POST', headers: { Origin: 'https://campusintell.test', 'Content-Type': 'application/json',
        [AUTH_CONTINUITY_HEADER]: 'page-token', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }))
    try { await run({ post, calls, state }) } finally {
      delete require.cache[requestFile]
      if (previousRequest) require.cache[requestFile] = previousRequest
    }
  } finally { Module._load = original; delete require.cache[file] }
}

test('real bounded parser accepts an identity-only request and keeps responses private with refreshed cookies', async () => fixture(async f => {
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('set-cookie'), /HttpOnly/)
  assert.deepEqual(await response.json(), { status: 'ready', feedback })
  assert.deepEqual(f.calls, [{ input: command(), token: 'page-token' }])
}))

test('cross-origin, wrong content type, oversized and malformed requests never reach publication', async () => fixture(async f => {
  for (const [body, headers, status] of [
    [command(), { Origin: 'https://elsewhere.test' }, 403],
    [command(), { 'sec-fetch-site': 'same-site' }, 403],
    [command(), { 'Content-Type': 'text/plain' }, 415],
    ['{', {}, 400], [{ ...command(), callerRubric: 'Invented' }, {}, 400],
    // Any answer field is refused, even blank or short; a full draft exceeds the identity-sized body bound.
    [{ ...command(), answer: '' }, {}, 400], [{ ...command(), answer: 'x' }, {}, 400],
    [{ ...command(), answer: longDraft() }, {}, 413],
    [{ ...command(), padding: 'x'.repeat(THEORY_BODY_MAX_BYTES) }, {}, 413],
  ]) {
    const response = await f.post(body, headers)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { status: 'invalid-request' })
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  assert.deepEqual(f.calls, [])
}))

test('all service outcomes map to explicit private HTTP responses', async () => fixture(async f => {
  for (const [status, code] of Object.entries({ 'signed-out': 401, incomplete: 403, 'not-found': 404,
    'invalid-request': 400, 'session-changed': 409, 'content-changed': 409, unavailable: 503 })) {
    f.state.result = { status }
    const response = await f.post()
    assert.equal(response.status, code)
    assert.deepEqual(await response.json(), { status })
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
}))
