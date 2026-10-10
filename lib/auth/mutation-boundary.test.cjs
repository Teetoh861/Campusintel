const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { z } = require('zod')

async function fixture(run) {
  const originalLoad = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const id = { a: randomUUID(), b: randomUUID(), sessionA: randomUUID(), sessionB: randomUUID(), item: randomUUID(), course: randomUUID() }
  const calls = [], state = { user: id.a, session: id.sessionA, role: 'operator', signedOut: false,
    cleanAuthState: false, invalidResidual: false, createThrows: false, lookupThrows: false, claimsError: false, signoutError: false, signoutThrows: false, discardThrows: false }
  const mocks = {
    '@/lib/supabase/server': { createClient: async response => {
      if (response) {
        if (!state.cleanAuthState) {
          response.cookies.set('sb-fixture.0', 'rotated-zero', { httpOnly: true })
          response.cookies.set('sb-fixture.1', 'rotated-one', { httpOnly: true })
        }
        response.headers.set('X-Refresh-Test', 'preserved')
      }
      if (state.createThrows) throw new Error('private client exception')
      return {
        auth: {
          getUser: async () => {
            calls.push('getUser')
            if (state.lookupThrows) throw new Error('private lookup failure')
            // Neither clean signed-out nor terminal invalid-user lookup performs
            // cleanup here: only the SDK signOut stub below owns cookie clears.
            if (state.invalidResidual) return { data: { user: null }, error: { code: 'user_not_found' } }
            if (state.signedOut) return { data: { user: null }, error: null }
            return { data: { user: { id: state.user } }, error: null }
          },
          getClaims: async () => {
            calls.push('getClaims')
            return { data: { claims: { sub: state.user, session_id: state.session } }, error: state.claimsError ? {} : null }
          },
          signOut: async ({ scope }) => {
            calls.push('signOut'); assert.equal(scope, 'local')
            if (state.cleanAuthState) return { error: null }
            response.cookies.set('sb-fixture.0', '', { httpOnly: true, maxAge: 0 })
            response.cookies.set('sb-fixture.1', '', { httpOnly: true, maxAge: 0 })
            if (state.signoutThrows) throw new Error('private SDK exception')
            return { error: state.signoutError ? { message: 'private SDK failure' } : null }
          },
        },
        from: table => {
          calls.push('role'); assert.equal(table, 'profiles')
          return { select: columns => {
            assert.equal(columns, 'role')
            return { eq: (column, user) => {
              assert.equal(column, 'id'); assert.equal(user, state.user)
              return { maybeSingle: async () => ({ data: { role: state.role }, error: null }) }
            } }
          } }
        },
      }
    } },
    '@/lib/auth/recovery-grant': {
      discardRecoveryGrant: async () => { calls.push('discard'); if (state.discardThrows) throw new Error('private grant failure') },
      clearRecoveryCookie: response => response.cookies.set('ci-recovery-grant', '', { maxAge: 0 }),
    },
    '@/lib/operator/editor-server': {
      writeOperatorContent: async (_, input) => { calls.push(['editor', input.action]); return { status: 'ok', data: { lockVersion: 2 } } },
    },
    '@/lib/quiz-attempts/current-student-attempt': {
      writeCurrentStudentAttempt: async () => { calls.push('quiz'); return { status: 'saved' } },
    },
  }
  try {
    Object.assign(process.env, { STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'https://campus.test',
      SUPABASE_SECRET_KEY: 'sb_secret_test_only_continuity_material', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'current-campus.vercel.app' })
    Module._load = function (name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    for (const file of ['./mutation-context.ts', './student-state.ts', '../operator/access.ts',
      '../../app/api/admin/editor/route.ts', '../../app/api/auth/logout/route.ts', '../../app/api/quiz-attempts/route.ts']) {
      delete require.cache[require.resolve(file)]
    }
    const { issueAccountContinuityToken } = require('./account-continuity.ts')
    const token = () => issueAccountContinuityToken(state.user, state.session)
    const request = (body, options = {}) => new Request('https://campus.test/api/private', {
      method: 'POST', headers: { origin: options.origin ?? 'https://campus.test',
        'content-type': 'application/json', ...options.headers },
      body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
    })
    const action = name => name === 'create' ? { action: name, createIntentId: id.item, courseId: id.course, kind: 'note', payload: { title: 'T', body: 'B' } }
      : name === 'provision' ? { action: name, institutionalCourseId: id.course }
        : { action: name, itemId: id.item, expectedLockVersion: 1,
          ...(['review', 'publish'].includes(name) ? { revision: 1 } : {}),
          ...(name === 'review' ? { decision: 'approved' } : {}), ...(name === 'revise' ? { payload: { title: 'T', body: 'B' } } : {}) }
    const editor = require('../../app/api/admin/editor/route.ts')
    const logout = require('../../app/api/auth/logout/route.ts')
    const post = (route, body, pageToken = token(), options = {}) => route.POST(request(body, {
      ...options, headers: { ...(pageToken === null ? {} : { 'x-campus-account-continuity': pageToken }), ...options.headers },
    }))
    await run({ id, state, calls, request, token, action, editor, logout, post })
  } finally {
    Module._load = originalLoad
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

test('auth, quiz and editor readers share canonical/preview trust and reject foreign/fetch-site origins', async () => fixture(async f => {
  const { readAuthRequest } = require('./request.ts')
  const { readEditorMutation } = require('../operator/editor-request.ts')
  const quiz = require('../../app/api/quiz-attempts/route.ts')
  for (const origin of ['https://campus.test', 'https://current-campus.vercel.app']) {
    assert.deepEqual(await readAuthRequest(f.request({}, { origin }), z.object({}).strict()), {})
    assert.deepEqual(await readEditorMutation(f.request(f.action('create'), { origin })), f.action('create'))
    assert.equal((await f.post(quiz, {}, f.token(), { origin })).status, 200)
    assert.equal((await f.post(f.editor, f.action('create'), f.token(), { origin })).status, 200)
  }
  for (const options of [{ origin: 'https://foreign.test' }, { origin: 'https://other-campus.vercel.app' },
    { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { 'sec-fetch-site': 'same-site' } }]) {
    await assert.rejects(readAuthRequest(f.request({}, options), z.unknown()), error => error.status === 403)
    await assert.rejects(readEditorMutation(f.request(f.action('create'), options)), error => error.status === 403)
    assert.equal((await f.post(quiz, {}, f.token(), options)).status, 403)
    const before = f.calls.filter(call => Array.isArray(call) && call[0] === 'editor').length
    assert.equal((await f.post(f.editor, f.action('create'), f.token(), options)).status, 403)
    assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'editor').length, before)
  }
}))

test('shared reader keeps domain body budgets and rejects oversized bodies before mutations', async () => fixture(async f => {
  const { readAuthRequest } = require('./request.ts')
  const quiz = require('../../app/api/quiz-attempts/route.ts')
  assert.equal((await readAuthRequest(f.request({ x: 'a'.repeat(4000) }), z.object({ x: z.string() }).strict())).x.length, 4000)
  await assert.rejects(readAuthRequest(f.request({ x: 'a'.repeat(4096) }), z.unknown()), error => error.status === 413)
  let cancelled = false
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(2048)))
    controller.enqueue(new TextEncoder().encode(' '.repeat(2049)))
  }, cancel() { cancelled = true } })
  await assert.rejects(readAuthRequest(new Request('https://campus.test/private', { method: 'POST', duplex: 'half',
    headers: { origin: 'https://campus.test', 'content-type': 'application/json' }, body: stream }), z.unknown()), error => error.status === 413)
  assert.equal(cancelled, true, 'stream is cancelled when cumulative bytes exceed the bound')
  assert.equal((await f.post(quiz, { x: 'a'.repeat(15000) })).status, 200)
  const beforeQuiz = f.calls.filter(call => call === 'quiz').length
  assert.equal((await f.post(quiz, ' '.repeat(16 * 1024 + 1))).status, 413)
  assert.equal(f.calls.filter(call => call === 'quiz').length, beforeQuiz)
  const large = { ...f.action('create'), payload: { title: 'T', body: 'a'.repeat(200000) } }
  assert.equal((await f.post(f.editor, large)).status, 200)
  const beforeEditor = f.calls.filter(Array.isArray).length
  assert.equal((await f.post(f.editor, ' '.repeat(280 * 1024 + 1))).status, 413)
  assert.equal(f.calls.filter(Array.isArray).length, beforeEditor)
}))

test('all readers reject invalid UTF-8, JSON, media types and unknown schema fields', async () => fixture(async f => {
  const { readAuthRequest } = require('./request.ts')
  const quiz = require('../../app/api/quiz-attempts/route.ts')
  for (const [body, headers, status] of [['{', {}, 400], [new Uint8Array([0xff]), {}, 400],
    [{}, { 'content-type': 'text/plain' }, 415], [{}, { 'content-type': 'application/jsonx' }, 415]]) {
    await assert.rejects(readAuthRequest(f.request(body, { headers }), z.unknown()), error => error.status === status)
    assert.equal((await f.post(quiz, body, f.token(), { headers })).status, status)
    assert.equal((await f.post(f.editor, body, f.token(), { headers })).status, status)
  }
  assert.equal((await f.post(f.editor, { ...f.action('create'), userId: f.id.b })).status, 400)
  await assert.rejects(readAuthRequest(f.request({ extra: true }), z.object({}).strict()), error => error.status === 400)
  assert.equal(f.calls.some(call => call === 'quiz' || Array.isArray(call)), false)
}))

test('editor request configuration failures stay unavailable and preserve its response-bound headers', async () => fixture(async f => {
  process.env.NEXT_PUBLIC_SITE_URL = 'invalid-origin-configuration'
  const response = await f.post(f.editor, f.action('create'))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('x-refresh-test'), 'preserved')
  assert.deepEqual(await response.json(), { status: 'unavailable', message: 'The editor is unavailable.' })
  assert.equal(f.calls.some(Array.isArray), false)
}))

test('every operator action requires the exact rendered account and session, separately from role', async () => fixture(async f => {
  const { getRenderedOperatorAccess } = require('../operator/access.ts')
  const render = await getRenderedOperatorAccess()
  assert.equal(render.status, 'operator')
  for (const name of ['create', 'revise', 'review', 'publish', 'unpublish', 'provision']) {
    assert.equal((await f.post(f.editor, f.action(name), render.continuityToken)).status, 200)
  }
  const before = f.calls.filter(Array.isArray).length
  f.state.user = f.id.b; f.state.session = f.id.sessionB
  for (const name of ['create', 'revise', 'review', 'publish', 'unpublish', 'provision']) {
    const response = await f.post(f.editor, f.action(name), render.continuityToken)
    assert.equal(response.status, 409); assert.equal((await response.json()).status, 'session-changed')
  }
  f.state.user = f.id.a
  assert.equal((await f.post(f.editor, f.action('revise'), render.continuityToken)).status, 409, 'new session for same user rejected')
  for (const token of [null, 'malformed']) assert.equal((await f.post(f.editor, f.action('create'), token)).status, 409)
  f.state.role = 'student'
  assert.equal((await f.post(f.editor, f.action('create'))).status, 403)
  assert.equal(f.calls.filter(Array.isArray).length, before)
}))

test('operator failure/invalid-context responses preserve only their own cookie/header changes', async () => fixture(async f => {
  for (const setup of [() => { f.state.lookupThrows = true }, () => { f.state.signedOut = true }, () => {}]) {
    setup()
    const response = await f.post(f.editor, { unexpected: true })
    assert.ok([400, 401, 503].includes(response.status))
    assert.equal(response.headers.get('x-refresh-test'), 'preserved')
    assert.match(response.headers.get('set-cookie'), /sb-fixture\.1=rotated-one/)
    assert.doesNotMatch(await response.text(), /private|rotated|sessionA|sessionB/)
    f.state.lookupThrows = false; f.state.signedOut = false
  }
}))

test('logout rejects stale, absent and malformed tokens without revoking the live session or recovery grant', async () => fixture(async f => {
  const old = f.token()
  f.state.user = f.id.b; f.state.session = f.id.sessionB
  for (const token of [old, null, 'malformed']) {
    const response = await f.post(f.logout, {}, token)
    assert.equal(response.status, 409); assert.equal((await response.json()).status, 'session-changed')
    assert.doesNotMatch(response.headers.get('set-cookie'), /Max-Age=0/)
    assert.match(response.headers.get('set-cookie'), /sb-fixture\.1=rotated-one/)
  }
  f.state.user = f.id.a
  assert.equal((await f.post(f.logout, {}, old)).status, 409)
  assert.equal(f.calls.includes('signOut'), false); assert.equal(f.calls.includes('discard'), false)
}))

test('logout preserves cookie chunks/cache headers on success, SDK error and unexpected exception', async () => fixture(async f => {
  for (const flag of [null, 'signoutError', 'signoutThrows', 'discardThrows', 'lookupThrows', 'claimsError', 'createThrows']) {
    if (flag) f.state[flag] = true
    const before = f.calls.filter(call => call === 'signOut').length
    const response = await f.post(f.logout, {})
    assert.equal(f.calls.filter(call => call === 'signOut').length, before +
      (!flag || ['signoutError', 'signoutThrows'].includes(flag) ? 1 : 0))
    assert.equal(response.status, flag ? 503 : 200)
    assert.equal(response.headers.get('x-refresh-test'), 'preserved')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    const cookies = response.headers.get('set-cookie')
    assert.match(cookies, /sb-fixture\.0=/); assert.match(cookies, /sb-fixture\.1=/)
    if (!flag || ['signoutError', 'signoutThrows'].includes(flag)) {
      const chunks = response.headers.getSetCookie().filter(cookie => cookie.startsWith('sb-fixture.'))
      assert.equal(chunks.length, 2)
      for (const chunk of chunks) { assert.match(chunk, /^sb-fixture\.[01]=;/); assert.match(chunk, /Max-Age=0/); assert.match(chunk, /HttpOnly/) }
    }
    assert.deepEqual(await response.json(), flag ? { error: 'Something went wrong. Please try again.' } : { success: true })
    if (flag) f.state[flag] = false
  }
  f.state.signedOut = true
  const before = f.calls.filter(call => call === 'signOut').length
  const response = await f.post(f.logout, {})
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /sb-fixture\.0=;/)
  assert.equal(f.calls.filter(call => call === 'signOut').length, before + 1)
}))

test('logout cleans invalid residual credentials only after conclusive live validation', async () => fixture(async f => {
  const rendered = f.token()
  f.state.invalidResidual = true
  for (const flag of [null, 'signoutError', 'signoutThrows']) {
    if (flag) f.state[flag] = true
    const before = f.calls.filter(call => call === 'signOut').length
    const response = await f.post(f.logout, {}, rendered)
    assert.equal(f.calls.filter(call => call === 'signOut').length, before + 1)
    assert.equal(response.status, flag ? 503 : 200)
    assert.deepEqual(await response.json(), flag ? { error: 'Something went wrong. Please try again.' } : { success: true })
    const chunks = response.headers.getSetCookie().filter(cookie => cookie.startsWith('sb-fixture.'))
    assert.equal(chunks.length, 2)
    for (const chunk of chunks) {
      assert.match(chunk, /^sb-fixture\.[01]=;/)
      assert.match(chunk, /Max-Age=0/)
    }
    if (flag) f.state[flag] = false
  }
  assert.equal(f.calls.includes('getClaims'), false, 'invalid user is never treated as a live replacement session')
}))

test('already clean signed-out logout is harmless on repeated requests', async () => fixture(async f => {
  f.state.signedOut = true; f.state.cleanAuthState = true
  for (let count = 1; count <= 2; count++) {
    const response = await f.post(f.logout, {}, null)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true })
    assert.equal(f.calls.filter(call => call === 'signOut').length, count)
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith('sb-fixture.')), false)
  }
}))
