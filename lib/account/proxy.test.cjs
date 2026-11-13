const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextRequest } = require('next/server')
const { randomUUID } = require('node:crypto')

// The first render reads this downstream request header; Next forwards it as an x-middleware-request-* override.
const chrome = response => response.headers.get('x-middleware-request-x-campus-chrome-state')

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const calls = [], state = { enabled: true, claims: { data: null, error: null }, throws: false,
    lifecycle: { status: 'active', deletionAllowed: true }, rpcError: false }
  try {
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config') return {
        isStudentAuthEnabled: () => state.enabled,
        getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'fixture-publishable' }),
      }
      if (name === '@supabase/ssr') return { createServerClient: (_url, _key, options) => {
        calls.push('client')
        return { auth: { getClaims: async () => {
          calls.push('claims')
          options.cookies.setAll([{ name: 'sb-fixture-auth-token', value: 'rotated', options: {} }], { 'X-Refresh-Test': 'preserved' })
          if (state.throws) throw new Error('private provider failure')
          return state.claims
        } }, rpc: async operation => {
          calls.push('lifecycle'); assert.equal(operation, 'read_account_lifecycle')
          return { data: state.lifecycle, error: state.rpcError ? {} : null }
        } }
      } }
      return load.call(this, name, ...args)
    }
    delete require.cache[require.resolve('../supabase/proxy.ts')]
    const { refreshStudentSession } = require('../supabase/proxy.ts')
    await run({ state, calls, request: (path = '/dashboard', method = 'GET', headers = {}) => refreshStudentSession(
      new NextRequest('http://localhost:3000' + path, { method, headers })) })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('proxy refreshes cookies without anonymous lifecycle calls when claims are missing, malformed or rejected', async () => fixture(async f => {
  for (const claims of [
    { data: null, error: null }, { data: {}, error: null },
    { data: { claims: {} }, error: null }, { data: { claims: { sub: '' } }, error: null },
    { data: { claims: { sub: 123 } }, error: null },
    { data: { claims: { sub: randomUUID() } }, error: { code: 'invalid_jwt' } },
  ]) {
    f.state.claims = claims; f.calls.length = 0
    const response = await f.request('/login')
    assert.deepEqual(f.calls, ['client', 'claims'])
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated')
  }
  f.state.throws = true; f.calls.length = 0
  assert.equal((await f.request()).headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(f.calls, ['client', 'claims'])
}))

test('page GETs hand the first render the live lifecycle answer and never a client-sent one', async () => fixture(async f => {
  const spoof = { 'x-campus-chrome-state': 'signed-in' }
  f.state.claims = { data: null, error: null }
  for (const path of ['/', '/tutors', '/access', '/dashboard']) assert.equal(chrome(await f.request(path, 'GET', spoof)), 'signed-out')
  f.state.claims = { data: { claims: { sub: randomUUID() } }, error: null }
  f.state.lifecycle = { status: 'active', deletionAllowed: true }
  f.calls.length = 0
  const live = await f.request('/tutors')
  assert.equal(chrome(live), 'signed-in')
  assert.deepEqual(f.calls, ['client', 'claims', 'lifecycle'], 'the existing lifecycle read is the only live check')
  assert.equal(live.cookies.get('sb-fixture-auth-token').value, 'rotated', 'a refresh on a public page is saved')
  assert.match(live.headers.get('x-middleware-request-cookie'), /sb-fixture-auth-token=rotated/, 'the render sees it too')
  f.state.lifecycle = { status: 'signed-out' }
  assert.equal(chrome(await f.request('/access', 'GET', { 'x-campus-chrome-state': 'signed-in' })), 'signed-out',
    'a revoked session with an unexpired token is signed out')
  f.state.lifecycle = { status: 'scheduled', deadline: '2026-11-15T00:00:00Z', requestId: randomUUID() }
  assert.equal(chrome(await f.request('/account/deletion')), 'signed-in', 'restricted accounts keep account chrome')
  for (const failure of [() => { f.state.rpcError = true }, () => { f.state.rpcError = false; f.state.throws = true }]) {
    failure()
    assert.equal(chrome(await f.request('/dashboard', 'GET', spoof)), 'unknown', 'a failed check is unknown, not a guess')
  }
  f.state.throws = false; f.state.enabled = false
  assert.equal(chrome(await f.request('/dashboard', 'GET', spoof)), 'signed-out')
}))

test('proxy reads lifecycle only for authenticated page GETs and preserves restricted redirects and refreshed cookies', async () => fixture(async f => {
  f.state.claims = { data: { claims: { sub: randomUUID() } }, error: null }
  for (const status of ['scheduled', 'expired']) {
    f.state.lifecycle = { status, deadline: '2026-11-15T00:00:00Z', requestId: randomUUID() }
    f.calls.length = 0
    const response = await f.request()
    assert.deepEqual(f.calls, ['client', 'claims', 'lifecycle'])
    assert.equal(response.headers.get('location'), 'http://localhost:3000/account/deletion')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated')
  }
  for (const [path, method, reads] of [['/account/deletion', 'GET', ['lifecycle']], ['/api/auth/session', 'GET', []],
    ['/dashboard', 'POST', []]]) {
    f.calls.length = 0
    assert.equal((await f.request(path, method)).headers.get('location'), null)
    assert.deepEqual(f.calls, ['client', 'claims', ...reads])
  }
  for (const lifecycle of [{ status: 'active', deletionAllowed: true }, { status: 'signed-out' }, null]) {
    f.state.lifecycle = lifecycle
    assert.equal((await f.request()).headers.get('location'), null)
  }
  f.state.rpcError = true
  assert.equal((await f.request()).headers.get('Cache-Control'), 'private, no-store')
  f.state.enabled = false; f.calls.length = 0
  assert.equal((await f.request()).headers.get('location'), null)
  assert.deepEqual(f.calls, [])
}))

// The landing page is prerendered and cannot read the session, so its signed-in redirect is decided here.
test('the landing page sends an active signed-in student home; every other visitor is served the page', async () => fixture(async f => {
  const home = 'http://localhost:3000/dashboard', student = () => ({ data: { claims: { sub: randomUUID() } }, error: null })
  const served = response => {
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('x-middleware-next'), '1')
  }
  // Signed out, even when the request claims otherwise: the redirect follows the live answer only.
  f.state.claims = { data: null, error: null }
  served(await f.request('/'))
  served(await f.request('/', 'GET', { 'x-campus-chrome-state': 'signed-in' }))
  // A live session on an active account, with or without a query string.
  f.state.claims = student()
  for (const path of ['/', '/?ref=whatsapp']) {
    f.calls.length = 0
    const response = await f.request(path)
    assert.equal(response.status, 307, path)
    assert.equal(response.headers.get('location'), home, path)
    assert.equal(response.headers.get('x-middleware-next'), null, 'the page is not rendered for a student who is leaving it')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', 'one student\'s redirect is never stored')
    assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated', 'a refresh on the way home is saved')
    assert.deepEqual(f.calls, ['client', 'claims', 'lifecycle'], 'the redirect costs no extra check')
  }
  // A session ended elsewhere still holds an unexpired token: the database says signed out, so the page is served.
  f.state.lifecycle = { status: 'signed-out' }
  const ended = await f.request('/')
  served(ended)
  assert.equal(chrome(ended), 'signed-out')
  // A restricted account is sent to its deletion page first, exactly as from any other page.
  for (const status of ['scheduled', 'expired']) {
    f.state.lifecycle = { status, deadline: '2026-11-15T00:00:00Z', requestId: randomUUID() }
    assert.equal((await f.request('/')).headers.get('location'), 'http://localhost:3000/account/deletion', status)
  }
  f.state.lifecycle = { status: 'active', deletionAllowed: true }
  // Only the landing page redirects home, and only when it is being opened.
  for (const path of ['/dashboard', '/login', '/register', '/access', '/tutors', '/courses', '/index', '/account/deletion']) {
    served(await f.request(path))
  }
  for (const method of ['HEAD', 'POST']) {
    f.calls.length = 0
    served(await f.request('/', method))
    assert.deepEqual(f.calls, ['client', 'claims'], method)
  }
}))

test('the landing page survives every unclear answer: a failed check never redirects', async () => fixture(async f => {
  const sub = randomUUID()
  const unclear = [
    ['a failed lifecycle read', () => { f.state.claims = { data: { claims: { sub } }, error: null }; f.state.rpcError = true }],
    ['an unreadable lifecycle answer', () => { f.state.rpcError = false; f.state.lifecycle = null }],
    ['a provider failure', () => { f.state.lifecycle = { status: 'active', deletionAllowed: true }; f.state.throws = true }],
    ['a retryable claims failure', () => { f.state.throws = false
      f.state.claims = { data: null, error: { name: 'AuthRetryableFetchError', status: 503 } } }],
    ['a session Auth no longer holds', () => { f.state.claims = { data: null, error: { name: 'AuthSessionMissingError', status: 400 } } }],
    ['claims without a student', () => { f.state.claims = { data: { claims: {} }, error: null } }],
    ['claims with an error', () => { f.state.claims = { data: { claims: { sub } }, error: { code: 'invalid_jwt' } } }],
  ]
  for (const [name, arrange] of unclear) {
    arrange()
    const response = await f.request('/')
    assert.equal(response.headers.get('location'), null, name)
    assert.equal(response.headers.get('x-middleware-next'), '1', name)
    assert.equal(chrome(response), 'unknown', name)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', name)
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated', `${name}: cookie changes still reach the browser`)
  }
  // With student accounts switched off nobody is signed in and nothing is asked.
  f.state.claims = { data: { claims: { sub } }, error: null }; f.state.enabled = false; f.calls.length = 0
  const off = await f.request('/')
  assert.equal(off.headers.get('location'), null)
  assert.equal(chrome(off), 'signed-out')
  assert.deepEqual(f.calls, [])
}))

test('a retryable claims failure must remain unknown rather than declare sign-out', async () => fixture(async f => {
  f.state.claims = { data: null, error: { name: 'AuthRetryableFetchError', status: 503 } }
  const response = await f.request('/tutors', 'GET', { 'x-campus-chrome-state': 'signed-in' })
  assert.equal(chrome(response), 'unknown')
  assert.deepEqual(f.calls, ['client', 'claims'])
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
  assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated')
}))

test('claims errors and unknown claims shapes never guess a public or student account state', async () => fixture(async f => {
  for (const claims of [{ data: undefined, error: null }, { data: {}, error: null },
    { data: { claims: {} }, error: null }, { data: { claims: { sub: '' } }, error: null },
    { data: { claims: { sub: 123 } }, error: null },
    { data: { claims: { sub: randomUUID() } }, error: { code: 'invalid_jwt' } }]) {
    f.state.claims = claims; f.calls.length = 0
    const response = await f.request('/access', 'GET', { 'x-campus-chrome-state': 'signed-out' })
    assert.equal(chrome(response), 'unknown')
    assert.deepEqual(f.calls, ['client', 'claims'])
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
  // The SDK's explicit no-session result remains a definitive visitor answer.
  f.state.claims = { data: null, error: null }
  assert.equal(chrome(await f.request('/tutors')), 'signed-out')
}))
