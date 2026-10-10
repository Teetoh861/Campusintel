const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { questionReportInput } = require('./input.ts')

async function fixture(run) {
  const originalLoad = Module._load
  const savedCache = new Map(Object.entries(require.cache))
  const id = { user: randomUUID(), session: randomUUID(), report: randomUUID(),
    course: randomUUID(), item: randomUUID(), question: randomUUID(), attempt: randomUUID() }
  const calls = []
  const state = { enabled: true, signedOut: false, authFailure: false,
    user: id.user, session: id.session, error: null, result: { status: 'reported', reportId: id.report } }
  const client = {
    auth: {
      getUser: async () => {
        if (state.authFailure) throw new Error('private Auth failure')
        return { data: { user: state.signedOut ? null : { id: state.user } }, error: null }
      },
      getClaims: async () => ({ data: { claims: { sub: state.user, session_id: state.session } }, error: null }),
    },
    rpc: async (name, command) => { calls.push({ name, command }); return { data: state.result, error: state.error } },
  }
  const mocks = {
    '@/lib/auth/config': { isStudentAuthEnabled: () => state.enabled,
      isTrustedAuthOrigin: origin => origin === 'http://localhost:3000',
      getAuthSecretKey: () => 'test-only-continuity-signing-material' },
    '@/lib/supabase/server': { createClient: async response => {
      response.cookies.set('sb-fixture', 'rotated', { httpOnly: true })
      return client
    } },
  }
  try {
    Module._load = function (name, ...args) {
      if (name === './config' && args[0]?.filename.includes('/lib/auth/')) return mocks['@/lib/auth/config']
      return mocks[name] || originalLoad.call(this, name, ...args)
    }
    for (const file of ['../auth/student-state.ts', '../auth/account-continuity.ts', '../auth/request.ts',
      './server.ts', '../../app/api/question-reports/route.ts']) delete require.cache[require.resolve(file)]
    const route = require('../../app/api/question-reports/route.ts')
    const domain = require('./server.ts')
    const continuity = require('../auth/account-continuity.ts')
    const token = () => continuity.issueAccountContinuityToken(state.user, state.session)
    const input = () => ({ courseId: id.course, itemId: id.item, revision: 1, questionId: id.question })
    const post = async (body = input(), pageToken = token(), headers = {}) => {
      const response = await route.POST(new Request('http://localhost:3000/api/question-reports', {
        method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
          ...(pageToken === null ? {} : { 'x-campus-account-continuity': pageToken }), ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }))
      return { response, body: await response.json() }
    }
    await run({ id, calls, state, route, domain, token, input, post })
  } finally {
    Module._load = originalLoad
    for (const key of Object.keys(require.cache)) if (!savedCache.has(key)) delete require.cache[key]
    for (const [key, entry] of savedCache) require.cache[key] = entry
  }
}

test('strict selectors reject identity spoofing, unknown keys and malformed values', () => {
  const input = { courseId: randomUUID(), itemId: randomUUID(), revision: 1 }
  for (const patch of [{ reporterId: randomUUID() }, { userId: randomUUID() }, { status: 'resolved' },
    { kind: 'note' }, { revision: 0 }, { revision: 1.5 }, { revision: 2147483648 },
    { courseId: 'slug' }, { itemId: 'bad' }, { attemptId: 'bad' }, { questionId: 'bad' },
    { note: 'x'.repeat(1001) }, { note: '\u0000' }]) {
    assert.equal(questionReportInput.safeParse({ ...input, ...patch }).success, false)
  }
  for (const note of [undefined, null, '', ' \n\t\u00a0\uFEFF ']) {
    assert.equal(questionReportInput.parse({ ...input, note }).note, null)
  }
  assert.equal(questionReportInput.parse({ ...input, note: '😀'.repeat(1000) }).note.length, 2000)
  assert.equal(questionReportInput.safeParse({ ...input, note: '😀'.repeat(1001) }).success, false)
})

test('first submission and duplicates preserve private cookies and expose only identity/result', async () => fixture(async f => {
  const result = await f.post({ ...f.input(), attemptId: f.id.attempt, note: '  suspected error  ' })
  assert.equal(result.response.status, 201)
  assert.deepEqual(result.body, { status: 'reported', reportId: f.id.report })
  assert.equal(result.response.headers.get('cache-control'), 'private, no-store')
  assert.equal(result.response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(result.response.headers.get('set-cookie'), /sb-fixture=rotated/)
  assert.deepEqual(f.calls, [{ name: 'submit_question_report', command: {
    p_course_id: f.id.course, p_item_id: f.id.item, p_content_revision: 1,
    p_question_id: f.id.question, p_attempt_id: f.id.attempt, p_note: 'suspected error',
  } }])
  f.state.result.status = 'already-reported'
  const duplicate = await f.post()
  assert.equal(duplicate.response.status, 200)
  assert.deepEqual(duplicate.body, { status: 'already-reported', reportId: f.id.report })
  assert.equal(f.route.GET, undefined)
}))

test('signed-out, disabled and failed Auth cannot submit', async () => fixture(async f => {
  for (const [flag, value, status, http] of [['signedOut', true, 'signed-out', 401],
    ['enabled', false, 'unavailable', 503], ['authFailure', true, 'unavailable', 503]]) {
    f.state[flag] = value
    const result = await f.post()
    assert.equal(result.response.status, http)
    assert.deepEqual(result.body, { status })
    assert.equal(f.calls.length, 0)
    f.state[flag] = !value
  }
}))

test('missing, forged and switched-account/session continuity is rejected', async () => fixture(async f => {
  const old = f.token()
  for (const token of [null, 'forged']) {
    assert.equal((await f.post(f.input(), token)).response.status, 409)
  }
  f.state.user = randomUUID()
  assert.equal((await f.post(f.input(), old)).body.status, 'session-changed')
  f.state.user = f.id.user
  f.state.session = randomUUID()
  assert.equal((await f.post(f.input(), old)).body.status, 'session-changed')
  assert.equal(f.calls.length, 0)
}))

test('same-origin, media type, bounded JSON and strict identity validation fail before RPC', async () => fixture(async f => {
  for (const [body, headers, http] of [[f.input(), { origin: 'https://evil.test' }, 403],
    [f.input(), { 'sec-fetch-site': 'cross-site' }, 403],
    [f.input(), { 'content-type': 'text/plain' }, 415], ['{', {}, 400],
    [{ ...f.input(), reporterId: f.id.user }, {}, 400],
    [{ ...f.input(), note: 'x'.repeat(1001) }, {}, 400], [' '.repeat(20000), {}, 413]]) {
    const result = await f.post(body, f.token(), headers)
    assert.equal(result.response.status, http)
    assert.deepEqual(result.body, { status: 'invalid-request' })
  }
  assert.equal(f.calls.length, 0)
}))

test('RPC failures and unexpected response payloads never leak internal information', async () => fixture(async f => {
  for (const [code, status, http] of [['22023', 'invalid-request', 400], ['42501', 'signed-out', 401],
    ['XX000', 'unavailable', 503]]) {
    f.state.error = { code, message: 'private SQL error', details: 'schema secret' }
    const result = await f.post()
    assert.equal(result.response.status, http)
    assert.deepEqual(result.body, { status })
  }
  f.state.error = null
  for (const result of [null, { status: 'reported', reportId: 'bad' },
    { status: 'reported', reportId: f.id.report, answerKey: 2 }]) {
    f.state.result = result
    assert.deepEqual((await f.post()).body, { status: 'unavailable' })
  }
  f.state.result = { status: 'limited' }
  assert.equal((await f.post()).response.status, 429)
}))
