const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AsyncLocalStorage } = require('node:async_hooks')
const { AUTH_API, AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED, EXISTING_STUDENT_SESSION,
  STUDENT_HOME_PATH, PASSWORD_RESET_DESTINATION } = require('./constants.ts')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body } }
function success(endpoint) {
  if (endpoint === AUTH_API.logout || endpoint === AUTH_API.cancelRecovery) return { success: true }
  if (endpoint === AUTH_API.reset) return { next: PASSWORD_RESET_DESTINATION }
  if (endpoint === AUTH_API.login || endpoint === AUTH_API.confirm) return { next: STUDENT_HOME_PATH }
  if (endpoint === AUTH_API.verifyRecovery) return { verified: true }
  return { message: endpoint === AUTH_API.forgot ? AUTH_MESSAGES.recovery : AUTH_MESSAGES.email }
}

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const saved = { window: global.window, fetch: global.fetch }
  const context = new AsyncLocalStorage(), events = [], requests = [], notifications = [], redirects = []
  const queue = []
  let active = false, transport = async endpoint => response(success(endpoint)), lockFailure = false
  // The two documents share only an origin LockManager and the simulated browser
  // cookie jar. Each has independent hook state. No timer decides ordering.
  const manager = {
    request(name, options, callback) {
      const document = context.getStore()
      events.push(['request-lock', document.name, name, options.mode])
      if (lockFailure === 'throw') throw new Error('private browser capability failure')
      if (lockFailure) return Promise.reject(new Error('private browser capability failure'))
      return new Promise((resolve, reject) => {
        queue.push({ document, name, callback, resolve, reject })
        drain()
      })
    },
  }
  function drain() {
    if (active || !queue.length) return
    active = true
    const job = queue.shift()
    events.push(['acquire', job.document.name])
    const complete = (settle, value) => {
      events.push(['release', job.document.name]); active = false
      settle(value); drain()
    }
    Promise.resolve().then(() => context.run(job.document, () => job.callback({ name: job.name, mode: 'exclusive' })))
      .then(value => complete(job.resolve, value), error => complete(job.reject, error))
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: manager } })
    global.window = { location: { replace: path => { redirects.push([context.getStore().name, path]) } } }
    global.fetch = async (endpoint, options) => {
      const document = context.getStore().name
      requests.push({ document, endpoint, options }); events.push(['fetch', document, endpoint])
      return transport(endpoint, options, document)
    }
    Module._load = function (name, ...args) {
      if (name === 'react') return {
        useRef(initial) {
          const document = context.getStore(), slot = document.index++
          if (!(slot in document.slots)) document.slots[slot] = { current: initial }
          return document.slots[slot]
        },
        useState(initial) {
          const document = context.getStore(), slot = document.index++
          if (!(slot in document.slots)) document.slots[slot] = initial
          return [document.slots[slot], value => { document.slots[slot] = value }]
        },
      }
      if (name === '@/lib/auth/client-events') return { notifyStudentChange: () => {
        const document = context.getStore().name
        assert.equal(active, true, 'notification must occur before releasing the Web Lock')
        notifications.push(document); events.push(['notify', document])
      } }
      return load.call(this, name, ...args)
    }
    const hookFile = require.resolve('../../components/auth/useAuthSubmit.ts')
    delete require.cache[hookFile]
    const { useAuthSubmit } = require(hookFile)
    const transition = require('./client-transition.ts')
    const tab = name => {
      const document = { name, slots: [], index: 0 }
      const view = () => context.run(document, () => { document.index = 0; return useAuthSubmit() })
      return { view, submit: (...args) => context.run(document, () => view().submit(...args)) }
    }
    await run({ tab, transition, requests, notifications, redirects, events,
      transport: fn => { transport = fn }, unavailable: () => {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
      }, failLock: value => { lockFailure = value } })
  } finally {
    Module._load = load
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('signed-out A/B login race: first admission installs A before faster B can send; server refuses account replacement', async () => fixture(async f => {
  const a = f.tab('A'), b = f.tab('B'), started = deferred(), network = deferred(), parsing = deferred(), body = deferred()
  const jar = { session: null }, providerLogins = [], cookiesSent = []
  f.transport(async (endpoint, options, document) => {
    assert.equal(endpoint, AUTH_API.login); assert.equal(options.credentials, 'same-origin')
    cookiesSent.push([document, jar.session])
    if (jar.session) return response({ code: EXISTING_STUDENT_SESSION, next: STUDENT_HOME_PATH }, 409)
    providerLogins.push(document)
    // B would be immediate if it could start while signed out.
    if (document === 'A') { started.resolve(); await network.promise }
    jar.session = document // Browser installs HttpOnly Set-Cookie BEFORE client body processing.
    f.events.push(['cookie', document])
    return { ok: true, status: 200, json: async () => { parsing.resolve(); return body.promise } }
  })
  const first = a.submit(AUTH_API.login, { email: 'a@example.test', password: 'fixture-password' })
  await started.promise
  assert.equal(await a.submit(AUTH_API.login, {}), null, 'active hook keeps synchronous double-submit protection')
  const second = b.submit(AUTH_API.login, { email: 'b@example.test', password: 'fixture-password' })
  assert.equal(b.view().pending, true)
  assert.equal(await b.submit(AUTH_API.login, {}), null, 'queued hook keeps synchronous double-submit protection')
  assert.deepEqual(f.requests.map(request => request.document), ['A'])
  network.resolve(); await parsing.promise
  assert.equal(jar.session, 'A')
  assert.equal(f.requests.length, 1, 'lock remains held while response.json is pending')
  assert.equal(f.notifications.length, 0)
  body.resolve({ next: STUDENT_HOME_PATH })
  assert.deepEqual(await first, { next: STUDENT_HOME_PATH })
  assert.equal(await second, null)
  assert.deepEqual(cookiesSent, [['A', null], ['B', 'A']])
  assert.deepEqual(providerLogins, ['A']); assert.equal(jar.session, 'A')
  assert.deepEqual(f.notifications, ['A']); assert.deepEqual(f.redirects, [['B', STUDENT_HOME_PATH]])
  const event = (name, document) => f.events.findIndex(value => value[0] === name && value[1] === document)
  assert.ok(event('cookie', 'A') < event('notify', 'A'))
  assert.ok(event('notify', 'A') < event('release', 'A'))
  assert.ok(event('release', 'A') < event('fetch', 'B'))
  assert.equal(a.view().pending, false); assert.equal(b.view().pending, false)
}))

test('login/confirmation in either order, reset/login and logout/login all share the same exclusive lock', async () => {
  for (const [firstEndpoint, secondEndpoint] of [[AUTH_API.login, AUTH_API.confirm], [AUTH_API.confirm, AUTH_API.login],
    [AUTH_API.reset, AUTH_API.login], [AUTH_API.login, AUTH_API.reset], [AUTH_API.logout, AUTH_API.login]]) await fixture(async f => {
    const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
    f.transport(async (endpoint, _, document) => {
      if (document === 'A') { started.resolve(); await release.promise }
      return response(success(endpoint))
    })
    const first = a.submit(firstEndpoint, {}, undefined, { continuityToken: 'rendered-A' })
    await started.promise
    const second = b.submit(secondEndpoint, {})
    assert.equal(f.requests.length, 1); assert.equal(b.view().pending, true)
    release.resolve(); await Promise.all([first, second])
    assert.deepEqual(f.requests.map(request => request.endpoint), [firstEndpoint, secondEndpoint])
    assert.deepEqual(f.notifications, ['A', 'B'])
    const locks = f.events.filter(event => event[0] === 'request-lock')
    assert.ok(locks.every(event => event[2] === f.transition.STUDENT_AUTH_TRANSITION_LOCK && event[3] === 'exclusive'))
    if (firstEndpoint === AUTH_API.logout) assert.equal(f.requests[0].options.headers['x-campus-account-continuity'], 'rendered-A')
  })
})

test('failed holder releases waiting document for validation/provider/rate/JSON/network errors without retry or notification', async () => {
  const failures = [
    () => response({ error: AUTH_MESSAGES.invalid }, 400),
    () => response({ error: AUTH_MESSAGES.credentials }, 400),
    () => response({ error: AUTH_MESSAGES.code }, 400),
    () => response({ error: AUTH_MESSAGES.unavailable }, 503),
    () => response({ error: AUTH_MESSAGES.limited }, 429),
    () => response({ unexpected: true }),
    () => ({ ok: true, status: 200, json: async () => { throw new Error('unreadable response') } }),
    () => { throw new Error('network failure') },
  ]
  for (const fail of failures) await fixture(async f => {
    const a = f.tab('A'), b = f.tab('B'), started = deferred(), release = deferred()
    f.transport(async (_, __, document) => {
      if (document === 'A') { started.resolve(); await release.promise; return fail() }
      return response({ next: STUDENT_HOME_PATH })
    })
    const first = a.submit(AUTH_API.login, {}); await started.promise
    const second = b.submit(AUTH_API.confirm, {})
    assert.equal(f.requests.length, 1)
    release.resolve()
    assert.equal(await first, null); assert.deepEqual(await second, { next: STUDENT_HOME_PATH })
    assert.equal(f.requests.length, 2); assert.deepEqual(f.notifications, ['B'])
    assert.equal(a.view().pending, false); assert.ok(Object.values(AUTH_MESSAGES).includes(a.view().error))
    assert.equal(b.view().pending, false)
  })
})

test('missing Web Locks or rejected acquisition sends zero transitions, releases local pending, and never notifies', async () => {
  for (const capability of ['missing', 'rejected', 'throwing']) await fixture(async f => {
    if (capability === 'missing') f.unavailable(); else f.failLock(capability === 'throwing' ? 'throw' : true)
    const tab = f.tab('A')
    for (const endpoint of [AUTH_API.login, AUTH_API.confirm, AUTH_API.reset, AUTH_API.logout]) {
      assert.equal(await tab.submit(endpoint, {}), null)
      assert.equal(tab.view().error, AUTH_MESSAGES.unavailable); assert.equal(tab.view().pending, false)
    }
    assert.equal(f.requests.length, 0); assert.equal(f.notifications.length, 0)
    assert.deepEqual(await tab.submit(AUTH_API.forgot, {}), { message: AUTH_MESSAGES.recovery })
    assert.equal(f.requests.length, 1, 'non-transition work does not require Web Locks')
  })
})

test('only the central login/confirm/reset/logout family locks; other Auth endpoints proceed while it is held', async () => fixture(async f => {
  assert.deepEqual(Object.values(AUTH_API).filter(f.transition.isStudentAuthTransition),
    [AUTH_API.login, AUTH_API.confirm, AUTH_API.reset, AUTH_API.logout])
  const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
  f.transport(async (endpoint, _, document) => {
    if (document === 'A') { started.resolve(); await release.promise }
    return response(success(endpoint))
  })
  const first = a.submit(AUTH_API.login, {}); await started.promise
  for (const endpoint of [AUTH_API.register, AUTH_API.resend, AUTH_API.forgot, AUTH_API.verifyRecovery, AUTH_API.cancelRecovery]) {
    assert.deepEqual(await b.submit(endpoint, {}), success(endpoint))
  }
  assert.equal(f.requests.length, 6)
  assert.equal(f.events.filter(event => event[0] === 'request-lock').length, 1)
  assert.deepEqual(f.notifications, [])
  release.resolve(); await first
  assert.deepEqual(f.notifications, ['A'])
}))

test('confirmation-required login and session-changed logout do not notify; logout failure retains continuity contract', async () => fixture(async f => {
  const tab = f.tab('A'), failures = []
  f.transport(async () => response({ code: EMAIL_CONFIRMATION_REQUIRED }))
  assert.deepEqual(await tab.submit(AUTH_API.login, {}), { code: EMAIL_CONFIRMATION_REQUIRED })
  assert.deepEqual(f.notifications, [])
  f.transport(async () => response({ status: 'session-changed' }, 409))
  assert.equal(await tab.submit(AUTH_API.logout, {}, failure => failures.push(failure), { continuityToken: 'rendered-A' }), null)
  assert.equal(f.requests.at(-1).options.headers['x-campus-account-continuity'], 'rendered-A')
  assert.deepEqual(failures, [{ message: AUTH_MESSAGES.sessionChanged, status: 'session-changed' }])
  assert.deepEqual(f.notifications, []); assert.deepEqual(f.redirects, [])
  assert.equal(tab.view().pending, false)
}))
