// lib/auth/student-state.test.cjs — Execute identity guards, page entry and unconfirmed resend transitions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const { AUTH_PATHS, AUTH_MESSAGES, EXISTING_STUDENT_SESSION, STUDENT_HOME_PATH } = require('./constants.ts')
const { AuthRequestError } = require('./request.ts')

async function fixture(run) {
  const original = Module._load, originalTsx = Module._extensions['.tsx']
  const loaded = []
  let signedIn = true, enabled = true, loginError, resendError, limitError, sessionError
  const calls = []
  const client = response => ({ auth: {
    getUser: async () => ({ data: { user: signedIn ? { id: 'fixture-user' } : null }, error: sessionError || (!signedIn ? { name: 'AuthSessionMissingError' } : null) }),
    getClaims: async () => ({ data: { claims: signedIn ? { sub: 'fixture-user' } : null }, error: null }),
    signOut: async options => { calls.push(['logout', options.scope]); signedIn = false; response.cookies.set('sb-fixture-auth-token', '', { maxAge: 0 }); return { error: null } },
  } })
  const mocks = {
    '@/lib/auth/recovery-grant': { discardRecoveryGrant: async () => {}, clearRecoveryCookie: () => {} },
    '@/lib/auth/config': { isStudentAuthEnabled: () => enabled },
    '@/lib/supabase/server': { createClient: async response => client(response) },
    '@/lib/auth/request': { readAuthRequest: async () => ({ email: 'student@example.test', password: 'fixture-password' }), getRequesterAddress: () => 'local' },
    '@/lib/auth/rate-limit': { consumeAuthLimit: async action => { calls.push(['limit', action]); if (action === 'RESEND_CONFIRMATION' && limitError) throw limitError } },
    '@/lib/supabase/auth-gateway': { getAuthGateway: () => ({
      signUp: async () => { calls.push(['signup']); return { data: { user: { id: 'fixture-user' }, session: null }, error: null } },
      signInWithPassword: async () => { calls.push(['login']); return { data: { session: null }, error: loginError } },
      resend: async () => { calls.push(['resend']); return { data: { user: null, session: null }, error: resendError ?? null } },
    }) },
    'next/navigation': { redirect: path => { throw new Error('redirect:' + path) } },
  }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) { return mocks[name] || original.call(this, name, ...args) }
    const load = file => { const path = require.resolve(file); loaded.push(path); delete require.cache[path]; return require(path) }
    // Ensure actual guard imports the fixture's request-scoped client.
    load('./student-state.ts')
    const gate = load('../../components/auth/SignedOutGate.tsx').SignedOutGate
    const post = async route => {
      const response = await load('../../app/api/auth/' + route + '/route.ts').POST(new Request('http://localhost/api/auth/' + route))
      return { response, body: await response.json() }
    }
    await run({ calls, post, gate, load, mocks, set: state => {
      if ('signedIn' in state) signedIn = state.signedIn
      if ('enabled' in state) enabled = state.enabled
      loginError = state.loginError; resendError = state.resendError; limitError = state.limitError; sessionError = state.sessionError
    } })
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of loaded) delete require.cache[file]
  }
}

test('signed-in identity entry pages redirect before rendering forms; disabled gate reads no session', async () => fixture(async f => {
  for (const route of ['register', 'login', 'confirm-email', 'forgot-password', 'reset-password', 'resend-confirmation']) {
    const page = f.load('../../app/' + route + '/page.tsx').default({ searchParams: Promise.resolve({}) })
    assert.equal(page.type.name, 'SignedOutGate')
    await assert.rejects(() => page.type(page.props), /redirect:\/dashboard/)
  }
  f.set({ enabled: false, sessionError: new Error('must not read session') })
  assert.equal(await f.gate({ children: 'disabled product content' }), 'disabled product content')
  f.set({ enabled: true, sessionError: new Error('private provider failure') })
  const failure = await f.gate({ children: 'form' })
  assert.equal(failure.props.message, AUTH_MESSAGES.unavailable)
}))

test('signed-in APIs cannot start or replace an identity; logout clears current session and permits signup', async () => fixture(async f => {
  for (const route of ['register', 'login', 'confirm-email', 'forgot-password', 'reset-password', 'resend-confirmation', 'verify-recovery']) {
    const { response, body } = await f.post(route)
    assert.equal(response.status, 409)
    assert.deepEqual(body, { code: EXISTING_STUDENT_SESSION, next: STUDENT_HOME_PATH })
  }
  assert.deepEqual(f.calls, [])
  const logout = await f.post('logout')
  assert.equal(logout.response.cookies.get('sb-fixture-auth-token').value, '')
  assert.deepEqual(f.calls, [['logout', 'local']])
  const registered = await f.post('register')
  assert.equal(registered.response.status, 200)
  assert.equal(f.calls.filter(call => call[0] === 'signup').length, 1)
}))

test('unconfirmed login advances only when confirmation resend can progress', async () => fixture(async f => {
  const scenarios = [
    { status: 200, body: { code: 'EMAIL_CONFIRMATION_REQUIRED' } },
    { status: 429, body: { error: AUTH_MESSAGES.limited }, limitError: new AuthRequestError(429, AUTH_MESSAGES.limited) },
    { status: 429, body: { error: AUTH_MESSAGES.limited }, resendError: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } },
    { status: 429, body: { error: AUTH_MESSAGES.limited }, resendError: { code: 'over_request_rate_limit' } },
    { status: 200, body: { code: 'EMAIL_CONFIRMATION_REQUIRED' }, resendError: { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 30 seconds.' } },
    { status: 503, body: { error: AUTH_MESSAGES.unavailable }, resendError: { code: 'unexpected', message: 'private provider detail' } },
    { status: 503, body: { error: AUTH_MESSAGES.unavailable }, limitError: new Error('private database failure') },
  ]
  for (const scenario of scenarios) {
    f.calls.length = 0
    f.set({ signedIn: false, loginError: { code: 'email_not_confirmed' }, ...scenario })
    const { response, body } = await f.post('login')
    assert.equal(response.status, scenario.status)
    assert.deepEqual(body, scenario.body)
    assert.deepEqual(f.calls.filter(call => call[0] === 'limit'), [['limit', 'LOGIN'], ['limit', 'RESEND_CONFIRMATION']])
    assert.equal(f.calls.filter(call => call[0] === 'resend').length, scenario.limitError ? 0 : 1)
  }
  f.calls.length = 0
  f.set({ signedIn: false, loginError: { code: 'invalid_credentials' } })
  const invalid = await f.post('login')
  assert.equal(invalid.response.status, 400)
  assert.deepEqual(invalid.body, { error: AUTH_MESSAGES.credentials })
  assert.equal(f.calls.some(call => call[0] === 'resend'), false)
}))


test('signed-out flows reconcile on focus and cross-tab changes; restored pages clear once', async () => fixture(async f => {
  const saved = { window: global.window, document: global.document, fetch: global.fetch }
  const listeners = new Map(), destinations = []
  let unsubscribe = false, changed, cleanup
  try {
    global.window = { location: { reload: () => destinations.push('reload'), replace: path => destinations.push(path) },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
    global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
    let state = { enabled: true, signedIn: false }
    global.fetch = async () => ({ ok: true, json: async () => state })
    f.mocks.react = { ...require('react'), useRef: value => ({ current: value }), useEffect: fn => { cleanup = fn() } }
    f.mocks['@/lib/auth/client-events'] = { onStudentChange: callback => { changed = callback; return () => { unsubscribe = true } } }
    f.load('../../components/auth/AuthFlowSync.tsx').AuthFlowSync({})
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(destinations, [])
    state = { enabled: true, signedIn: true }
    listeners.get('blur')()
    listeners.get('focus')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(destinations.at(-1), '/dashboard')
    cleanup()

    destinations.length = 0
    state = { enabled: true, signedIn: false }
    f.load('../../components/auth/AuthFlowSync.tsx').AuthFlowSync({})
    await new Promise(resolve => setImmediate(resolve))
    changed()
    listeners.get('pageshow')({ persisted: true })
    assert.deepEqual(destinations, ['reload'])
    cleanup()
    assert.equal(unsubscribe, true)
    assert.equal(listeners.size, 0)
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
}))

test('same signed-in account survives visibility and focus bursts without a reload or request storm', async () => fixture(async f => {
  const saved = { window: global.window, document: global.document, fetch: global.fetch }
  const listeners = new Map(), documentListeners = new Map(), destinations = [], requests = []
  let cleanup, mountedRef, visibilityState = 'visible'
  try {
    global.window = { location: { reload: () => destinations.push('reload'), replace: path => destinations.push(path) },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
    global.document = { get visibilityState() { return visibilityState },
      addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) }
    global.fetch = async (path, options) => {
      requests.push([path, options])
      return { ok: true, json: async () => ({ enabled: true, signedIn: true, sameAccount: true }) }
    }
    f.mocks.react = { ...require('react'),
      useRef: value => (mountedRef ??= { current: value }),
      useEffect: fn => { cleanup?.(); cleanup = fn() },
    }
    f.mocks['@/lib/auth/client-events'] = { onStudentChange: () => () => {} }
    const flow = f.load('../../components/auth/AuthFlowSync.tsx').AuthFlowSync
    flow({ signedIn: true, continuityToken: 'page-token' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 1)
    assert.equal(requests[0][1].headers['x-campus-account-continuity'], 'page-token')
    visibilityState = 'hidden'; documentListeners.get('visibilitychange')()
    visibilityState = 'visible'; documentListeners.get('visibilitychange')()
    listeners.get('focus')()
    listeners.get('focus')()
    documentListeners.get('visibilitychange')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 2)
    assert.deepEqual(destinations, [])
    visibilityState = 'hidden'
    flow({ signedIn: true, continuityToken: 'new-rsc-token' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 3)
    assert.equal(requests[2][1].headers['x-campus-account-continuity'], 'page-token')
    visibilityState = 'visible'; documentListeners.get('visibilitychange')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 4, 'an effect mounted while hidden still checks on return')
    assert.deepEqual(destinations, [])
    cleanup()
    assert.equal(listeners.size, 0)
    assert.equal(documentListeners.size, 0)
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
}))

test('foreground reconciliation serializes in-flight checks and applies a queued session change', async () => fixture(async f => {
  const saved = { window: global.window, document: global.document, fetch: global.fetch }
  const listeners = new Map(), documentListeners = new Map(), destinations = [], requests = []
  let cleanup, visibilityState = 'visible', inFlight = 0, peakInFlight = 0
  try {
    global.window = { location: { reload: () => destinations.push('reload'), replace: path => destinations.push(path) },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
    global.document = { get visibilityState() { return visibilityState },
      addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) }
    global.fetch = (path, options) => {
      inFlight++
      peakInFlight = Math.max(peakInFlight, inFlight)
      return new Promise(resolve => requests.push({ path, options, settle: state => {
        inFlight--
        resolve({ ok: true, json: async () => state })
      } }))
    }
    f.mocks.react = { ...require('react'), useRef: value => ({ current: value }), useEffect: fn => { cleanup = fn() } }
    f.mocks['@/lib/auth/client-events'] = { onStudentChange: () => () => {} }
    f.load('../../components/auth/AuthFlowSync.tsx').AuthFlowSync({ signedIn: true, continuityToken: 'page-token' })
    assert.equal(requests.length, 1, 'the initial live check is still pending')
    const burst = () => {
      for (let index = 0; index < 5; index++) {
        visibilityState = 'hidden'; documentListeners.get('visibilitychange')()
        visibilityState = 'visible'; documentListeners.get('visibilitychange')()
        listeners.get('focus')()
      }
    }
    const sameSession = { enabled: true, signedIn: true, sameAccount: true }
    burst()
    assert.equal(requests.length, 1, 'foreground events queue without starting parallel checks')
    requests[0].settle(sameSession)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 2, 'the burst produces exactly one follow-up check')
    assert.deepEqual(destinations, [])
    requests[1].settle(sameSession)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 2)
    assert.deepEqual(destinations, [], 'matching session keeps the page mounted')

    listeners.get('blur')(); listeners.get('focus')()
    assert.equal(requests.length, 3)
    burst()
    assert.equal(requests.length, 3)
    requests[2].settle(sameSession)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 4, 'later foreground events still queue one check')
    requests[3].settle({ enabled: true, signedIn: true, sameAccount: false })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(destinations, ['reload'], 'a later mismatch discards the stale page')
    assert.equal(peakInFlight, 1)
    assert.equal(inFlight, 0)
    cleanup()
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
}))

test('revocation, account change, malformed status and cross-tab logout discard signed-in page state', async () => fixture(async f => {
  const saved = { window: global.window, document: global.document, fetch: global.fetch }
  const listeners = new Map(), destinations = []
  let cleanup, changed, state = { enabled: true, signedIn: true, sameAccount: true }
  try {
    global.window = { location: { reload: () => destinations.push('reload'), replace: path => destinations.push(path) },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
    global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
    global.fetch = async () => ({ ok: true, json: async () => state })
    f.mocks.react = { ...require('react'), useRef: value => ({ current: value }), useEffect: fn => { cleanup = fn() } }
    f.mocks['@/lib/auth/client-events'] = { onStudentChange: callback => { changed = callback; return () => {} } }
    const mount = () => f.load('../../components/auth/AuthFlowSync.tsx').AuthFlowSync({ signedIn: true, continuityToken: 'page:student-a' })
    for (const changedState of [
      { enabled: true, signedIn: false, sameAccount: false },
      { enabled: true, signedIn: true, sameAccount: false },
      { enabled: 'invalid', signedIn: true, sameAccount: true },
    ]) {
      state = { enabled: true, signedIn: true, sameAccount: true }
      mount()
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(destinations, [])
      state = changedState
      listeners.get('blur')(); listeners.get('focus')()
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(destinations, ['reload'])
      cleanup(); destinations.length = 0
    }
    state = { enabled: true, signedIn: true, sameAccount: true }
    mount()
    await new Promise(resolve => setImmediate(resolve))
    changed()
    assert.deepEqual(destinations, ['reload'])
    cleanup()
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
}))

test('cross-tab messages contain no identity and unavailable channels cannot fail completed auth', () => {
  const saved = global.BroadcastChannel
  const messages = []
  try {
    global.BroadcastChannel = class { postMessage(value) { messages.push(value) } close() {} }
    const { notifyStudentChange } = require('./client-events.ts')
    notifyStudentChange()
    assert.deepEqual(messages, ['changed'])
    global.BroadcastChannel = class { constructor() { throw new Error('disabled browser feature') } }
    assert.doesNotThrow(notifyStudentChange)
  } finally { global.BroadcastChannel = saved }
})

test('student refresh excludes custom admin paths before reading student configuration', async () => fixture(async f => {
  const { NextRequest } = require('next/server')
  let configurationReads = 0
  f.mocks['@/lib/auth/config'].getSupabaseConfig = () => { configurationReads++; throw new Error('must not read student configuration') }
  const { refreshStudentSession } = f.load('../supabase/proxy.ts')
  for (const path of ['/admin', '/admin/settings', '/api/admin/login', '/api/admin/logout']) {
    const response = await refreshStudentSession(new NextRequest('http://localhost' + path))
    assert.equal(response.headers.get('x-middleware-next'), '1')
  }
  assert.equal(configurationReads, 0)
}))

test('student refresh proxy is scoped away from ordinary public browsing', () => {
  const { config } = require('../../proxy.ts')
  assert.deepEqual(config.matcher, [
    '/account/:path*',
    '/dashboard/:path*',
    '/profile-selection',
    '/api/auth/:path*',
    '/login',
    '/register',
    '/confirm-email',
    '/forgot-password',
    '/reset-password',
    '/resend-confirmation',
  ])
  assert.equal(config.matcher.some(pattern => pattern.includes('courses') || pattern.includes('tutors') || pattern.includes('materials')), false)
})

test('successful auth notification cannot reload its own tab before redirect, but still notifies other tabs', () => {
  const saved = global.BroadcastChannel
  const channels = new Set()
  let ownReloads = 0, otherReloads = 0
  try {
    global.BroadcastChannel = class {
      constructor() { channels.add(this) }
      postMessage(data) { for (const target of channels) if (target !== this) target.onmessage?.({ data }) }
      close() { channels.delete(this) }
    }
    const { onStudentChange, notifyStudentChange } = require('./client-events.ts')
    const unsubscribe = onStudentChange(() => ownReloads++)
    const otherTab = new BroadcastChannel()
    otherTab.onmessage = () => otherReloads++
    notifyStudentChange()
    assert.equal(ownReloads, 0)
    assert.equal(otherReloads, 1)
    otherTab.postMessage('changed')
    assert.equal(ownReloads, 1)
    unsubscribe(); otherTab.close()
    assert.equal(channels.size, 0)
  } finally { global.BroadcastChannel = saved }
})
