const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const ids = { user: randomUUID(), other: randomUUID(), session: randomUUID(), course: randomUUID(), intent: randomUUID() }
  const calls = [], inputs = [], cookie = 'ci-student-auth-' + 'a'.repeat(32)
  const state = { user: ids.user, session: ids.session, role: 'operator', signedOut: false,
    authError: false, roleError: false, domainError: false, clearCookies: false,
    result: { status: 'ok', data: { itemId: randomUUID() } } }
  let bodyReads = 0
  const server = { createClient: async base => {
    calls.push('createClient')
    const client = { rpc: async name => { assert.equal(name, 'read_account_lifecycle'); return { data: { status: 'active', deletionAllowed: true }, error: null } }, auth: {
      getUser: async () => {
        calls.push('getUser')
        for (const index of [0, 1]) base.cookies.set(cookie + '.' + index, state.clearCookies ? '' : 'rotated-' + index,
          { httpOnly: true, path: '/', ...(state.clearCookies ? { maxAge: 0 } : {}) })
        base.headers.set('X-Refresh-Test', 'preserved')
        if (state.authError) throw new Error('private provider error')
        return { data: { user: state.signedOut ? null : { id: state.user } }, error: null }
      },
      getClaims: async () => {
        calls.push('getClaims')
        return { data: { claims: { sub: state.user, session_id: state.session } }, error: null }
      },
    }, from: table => {
      calls.push('roleLookup'); assert.equal(table, 'profiles')
      return { select: columns => {
        assert.equal(columns, 'role')
        return { eq: (column, actor) => {
          assert.equal(column, 'id'); assert.equal(actor, state.user)
          return { maybeSingle: async () => ({ data: state.roleError ? null : { role: state.role },
            error: state.roleError ? { message: 'private role error' } : null }) }
        } }
      } }
    } }
    return client
  } }
  try {
    Object.assign(process.env, { STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'https://campus.test',
      SUPABASE_SECRET_KEY: 'sb_secret_test_only_editor_request_ordering_material', VERCEL: '0' })
    Module._load = function (name, ...args) {
      if (name === '@/lib/supabase/server') return server
      if (name === '@/lib/operator/editor-server') return { writeOperatorContent: async (client, input) => {
        calls.push('writeOperatorContent'); inputs.push(input)
        assert.equal(typeof client.auth.getUser, 'function')
        if (state.domainError) throw new Error('private domain error')
        return state.result
      } }
      const actual = load.call(this, name, ...args)
      // Observe real production boundaries without replacing parsing, continuity or authorization.
      if (name === '@/lib/operator/editor-request') return { ...actual, readEditorMutation: async request => {
        calls.push('readEditorMutation')
        const input = await actual.readEditorMutation(request)
        calls.push('requestAccepted')
        return input
      } }
      if (name === '@/lib/auth/mutation-context') return { ...actual, getAuthenticatedMutationContext: async (...input) => {
        calls.push('getAuthenticatedMutationContext')
        return actual.getAuthenticatedMutationContext(...input)
      } }
      if (name === '@/lib/operator/access') return { ...actual, authorizeOperatorContext: async context => {
        calls.push('authorizeOperatorContext')
        return actual.authorizeOperatorContext(context)
      } }
      return actual
    }
    for (const file of ['./editor-request.ts', './access.ts', '../auth/request.ts', '../auth/config.ts',
      '../auth/mutation-context.ts', '../auth/student-state.ts', '../auth/account-continuity.ts',
      '../../app/api/admin/editor/route.ts']) delete require.cache[require.resolve(file)]
    const { issueAccountContinuityToken } = require('../auth/account-continuity.ts')
    const route = require('../../app/api/admin/editor/route.ts')
    const input = { action: 'create', createIntentId: ids.intent, courseId: ids.course,
      kind: 'note', payload: { title: 'Note', body: 'Body' } }
    const token = () => issueAccountContinuityToken(state.user, state.session)
    const request = (body = input, options = {}) => {
      const renderedToken = options.token === undefined ? token() : options.token
      const req = new Request('https://campus.test/api/admin/editor', { method: 'POST',
        headers: { origin: 'https://campus.test', 'content-type': 'application/json',
          cookie: `ci-student-session-generation=${'a'.repeat(32)}; ${cookie}.0=existing-session`,
          ...(renderedToken === null ? {} : { 'x-campus-account-continuity': renderedToken }), ...options.headers },
        body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) })
      if (options.missingContentType) req.headers.delete('content-type')
      const getReader = req.body.getReader.bind(req.body)
      req.body.getReader = (...args) => { bodyReads++; return getReader(...args) }
      return req
    }
    await run({ route, calls, inputs, ids, state, input, token, request, cookie, bodyReads: () => bodyReads })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

const rejections = [
  ['foreign Origin', 403, f => f.request(f.input, { headers: { origin: 'https://foreign.test' } })],
  ['cross-site Sec-Fetch-Site', 403, f => f.request(f.input, { headers: { 'sec-fetch-site': 'cross-site' } })],
  ['same-site Sec-Fetch-Site', 403, f => f.request(f.input, { headers: { 'sec-fetch-site': 'same-site' } })],
  ['wrong Content-Type', 415, f => f.request(f.input, { headers: { 'content-type': 'text/plain' } })],
  ['missing Content-Type', 415, f => f.request(f.input, { missingContentType: true })],
  ['malformed JSON', 400, f => f.request('{')],
  ['invalid UTF-8', 400, f => f.request(new Uint8Array([0xff]))],
  ['invalid action schema', 400, f => f.request({ action: 'create' })],
  ['forged extra identity field', 400, f => f.request({ ...f.input, userId: f.ids.other })],
  ['body exceeding 280 KiB', 413, f => f.request(' '.repeat(280 * 1024 + 1))],
  ['disabled Auth rollout', 503, f => { process.env.STUDENT_AUTH_ENABLED = 'false'; return f.request() }],
  ['unavailable origin configuration', 503, f => { process.env.NEXT_PUBLIC_SITE_URL = 'invalid'; return f.request() }],
]

for (const [name, status, makeRequest] of rejections) test(`${name} rejects before every Auth/provider/role/domain call`, async () => fixture(async f => {
  const response = await f.route.POST(makeRequest(f))
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), { status: status === 503 ? 'unavailable' : 'invalid',
    message: status === 503 ? 'The editor is unavailable.' : 'The editor request is invalid.' })
  assert.deepEqual(f.calls, ['readEditorMutation'], 'no mutation context, client, provider, continuity, role or domain work')
  assert.equal(f.inputs.length, 0)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('x-refresh-test'), null)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
}))

test('valid create parses once before live Auth, continuity, role and the unchanged domain input', async () => fixture(async f => {
  const response = await f.route.POST(f.request())
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), f.state.result)
  assert.deepEqual(f.calls, ['readEditorMutation', 'requestAccepted', 'getAuthenticatedMutationContext',
    'createClient', 'getUser', 'getClaims', 'authorizeOperatorContext', 'roleLookup', 'writeOperatorContent'])
  assert.equal(f.bodyReads(), 1)
  assert.deepEqual(f.inputs, [f.input], 'createIntentId and payload reach the same domain operation unchanged')
}))

test('a valid mutation exactly at the existing 280 KiB body bound still proceeds', async () => fixture(async f => {
  const body = JSON.stringify(f.input)
  const response = await f.route.POST(f.request(body + ' '.repeat(280 * 1024 - Buffer.byteLength(body))))
  assert.equal(response.status, 200); assert.equal(f.bodyReads(), 1)
  assert.deepEqual(f.inputs, [f.input])
}))

function assertResponseCookies(response, f, cleared = false) {
  assert.equal(response.headers.get('x-refresh-test'), 'preserved')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  const cookies = response.headers.getSetCookie()
  assert.equal(cookies.length, 2)
  for (const index of [0, 1]) {
    const header = cookies.find(value => value.startsWith(f.cookie + '.' + index + '='))
    assert.ok(header); assert.match(header, /HttpOnly/)
    if (cleared) { assert.ok(header.startsWith(f.cookie + '.' + index + '=;')); assert.match(header, /Max-Age=0/) }
    else assert.ok(header.startsWith(f.cookie + '.' + index + '=rotated-' + index + ';'))
  }
}

test('stale rendered identity and missing/malformed continuity refuse a valid mutation and retain refresh cookies', async () => {
  for (const context of ['other-account', 'rotated-session', 'missing', 'malformed']) await fixture(async f => {
    let token = f.token()
    if (context === 'other-account') f.state.user = f.ids.other
    if (context === 'rotated-session') f.state.session = randomUUID()
    if (context === 'missing') token = null
    if (context === 'malformed') token = 'malformed'
    const response = await f.route.POST(f.request(f.input, { token }))
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { status: 'session-changed',
      message: 'Your account or session changed. Reload the workspace before continuing.' })
    assert.deepEqual(f.calls, ['readEditorMutation', 'requestAccepted', 'getAuthenticatedMutationContext', 'createClient', 'getUser', 'getClaims'])
    assertResponseCookies(response, f)
  })
})

test('accepted requests preserve refresh/clearing cookies on signed-out, forbidden and unavailable Auth or role results', async () => {
  for (const reason of ['signed-out', 'forbidden', 'auth-error', 'role-error']) await fixture(async f => {
    if (reason === 'signed-out') { f.state.signedOut = true; f.state.clearCookies = true }
    if (reason === 'forbidden') f.state.role = 'student'
    if (reason === 'auth-error') f.state.authError = true
    if (reason === 'role-error') f.state.roleError = true
    const response = await f.route.POST(f.request())
    assert.equal(response.status, reason === 'signed-out' ? 401 : reason === 'forbidden' ? 403 : 503)
    assert.deepEqual(await response.json(), { status: ['signed-out', 'forbidden'].includes(reason) ? reason : 'unavailable' })
    assert.equal(f.calls.includes('writeOperatorContent'), false)
    assertResponseCookies(response, f, reason === 'signed-out')
  })
})

test('operator/domain results and thrown domain failures retain only this accepted request’s cookie changes', async () => {
  for (const status of ['ok', 'invalid', 'conflict', 'forbidden', 'unavailable', 'throw']) await fixture(async f => {
    if (status === 'throw') f.state.domainError = true
    else f.state.result = { status, message: 'Safe domain result.' }
    const response = await f.route.POST(f.request())
    assert.equal(response.status, status === 'ok' ? 200 : status === 'invalid' ? 422 : status === 'conflict' ? 409 : status === 'forbidden' ? 403 : 503)
    assert.deepEqual(await response.json(), status === 'throw'
      ? { status: 'unavailable', message: 'The editor is unavailable.' } : f.state.result)
    assert.equal(f.calls.at(-1), 'writeOperatorContent')
    assertResponseCookies(response, f)
  })
})
