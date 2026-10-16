const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTH_API, AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED, EXISTING_STUDENT_SESSION,
  STUDENT_HOME_PATH } = require('./constants.ts')
const { fixture, deferred, response, success } = require('./auth-transition-fixture.cjs')

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
    [AUTH_API.reset, AUTH_API.login], [AUTH_API.login, AUTH_API.reset], [AUTH_API.logout, AUTH_API.login],
    [AUTH_API.scheduleDeletion, AUTH_API.login], [AUTH_API.cancelDeletion, AUTH_API.logout]]) await fixture(async f => {
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

test('missing Web Locks or rejected acquisition sends zero ordered Auth requests, releases local pending, and never notifies', async () => {
  for (const capability of ['missing', 'rejected', 'throwing']) await fixture(async f => {
    if (capability === 'missing') f.unavailable(); else f.failLock(capability === 'throwing' ? 'throw' : true)
    const tab = f.tab('A')
    for (const endpoint of [AUTH_API.login, AUTH_API.confirm, AUTH_API.forgot, AUTH_API.verifyRecovery,
      AUTH_API.cancelRecovery, AUTH_API.reset, AUTH_API.logout, AUTH_API.scheduleDeletion, AUTH_API.cancelDeletion]) {
      assert.equal(await tab.submit(endpoint, {}), null)
      assert.equal(tab.view().error, AUTH_MESSAGES.unavailable); assert.equal(tab.view().pending, false)
    }
    assert.equal(f.requests.length, 0); assert.equal(f.notifications.length, 0)
    for (const endpoint of [AUTH_API.register, AUTH_API.resend]) {
      assert.deepEqual(await tab.submit(endpoint, {}), { message: AUTH_MESSAGES.email })
    }
    assert.equal(f.requests.length, 2, 'register/resend do not require Web Locks')
    assert.equal(f.notifications.length, 0)
  })
})

test('central response ordering is distinct from session notifications; only register/resend POSTs remain unlocked', async () => fixture(async f => {
  assert.deepEqual(Object.values(AUTH_API).filter(f.transition.isStudentAuthTransition),
    [AUTH_API.login, AUTH_API.confirm, AUTH_API.reset, AUTH_API.logout, AUTH_API.scheduleDeletion, AUTH_API.cancelDeletion])
  assert.deepEqual(Object.values(AUTH_API).filter(f.transition.requiresAuthResponseOrdering),
    [AUTH_API.login, AUTH_API.confirm, AUTH_API.forgot, AUTH_API.verifyRecovery,
      AUTH_API.cancelRecovery, AUTH_API.reset, AUTH_API.logout, AUTH_API.scheduleDeletion, AUTH_API.cancelDeletion])
  assert.deepEqual(Object.values(AUTH_API).filter(endpoint => endpoint !== AUTH_API.session &&
    !f.transition.requiresAuthResponseOrdering(endpoint)), [AUTH_API.register, AUTH_API.resend])
  const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
  f.transport(async (endpoint, _, document) => {
    if (document === 'A') { started.resolve(); await release.promise }
    return response(success(endpoint))
  })
  const first = a.submit(AUTH_API.login, {}); await started.promise
  for (const endpoint of [AUTH_API.register, AUTH_API.resend]) {
    assert.deepEqual(await b.submit(endpoint, {}), success(endpoint))
  }
  assert.equal(f.requests.length, 3)
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
