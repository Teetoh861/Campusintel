const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, response } = require('./auth-transition-fixture.cjs')
const { AUTH_API, AUTH_MESSAGES, RECOVERY_FAILURE, STUDENT_HOME_PATH } = require('./constants.ts')
const { AUTH_BROWSER_TIMEOUT_MS } = require('./client-request.ts')
const { fetchAuthReply } = require('./client-request.ts')
const flush = () => new Promise(resolve => setImmediate(resolve))

async function timed(t, run) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try { await fixture(run) } finally { t.mock.timers.reset() }
}

test('fetch rejection, malformed JSON, invalid reply and 503 have their exact distinct messages', async () => fixture(async f => {
  const cases = [
    [async () => { throw new Error('student@example.test private token') }, AUTH_MESSAGES.connection],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('private response') } }), AUTH_MESSAGES.unavailable],
    [async () => response({}), AUTH_MESSAGES.unavailable],
    [async () => response({ reference: 'ABCD2345' }), AUTH_MESSAGES.unavailable],
    [async () => ({ ok: true, status: 200, headers: new Headers({ 'X-CampusIntell-Auth-Reference': 'ABCD2345' }),
      json: async () => { throw new SyntaxError('invalid reply') } }), AUTH_MESSAGES.unavailable],
    [async () => response({ error: 'untrusted internal exception', reference: 'ABCD2345' }, 503), AUTH_MESSAGES.unavailable],
    [async () => response({ error: AUTH_MESSAGES.credentials }, 503), AUTH_MESSAGES.unavailable],
    [async () => response({ error: AUTH_MESSAGES.unavailable, reference: 'student@example.test' }, 503), AUTH_MESSAGES.unavailable],
  ]
  for (const [transport, expected] of cases) {
    f.transport(transport)
    const tab = f.tab('A')
    assert.equal(await tab.submit(AUTH_API.register, {}), null)
    assert.equal(tab.view().error, expected)
    assert.equal(tab.view().pending, false)
  }
  assert.equal(AUTH_MESSAGES.connection, "We couldn’t reach CampusIntell. Check your connection and try again.")
  assert.equal(AUTH_MESSAGES.unavailable, "We couldn’t complete your request right now. Please try again in a minute.")
}))

test('missing Web Locks has the approved browser message and never falls back to competing cookie writers', async () => fixture(async f => {
  f.unavailable()
  const tab = f.tab('A')
  assert.equal(await tab.submit(AUTH_API.login, {}), null)
  assert.equal(tab.view().error, 'Your browser needs an update to continue. Update it, or use the latest Chrome, Safari or Firefox.')
  assert.equal(f.requests.length, 0)
  assert.equal(f.notifications.length, 0)
}))

test('ordinary errors keep their exact message without a reference, with or without a stray header or body reference', async () => fixture(async f => {
  for (const [endpoint, text, status] of [[AUTH_API.login, 'Incorrect email or password.', 400],
    [AUTH_API.confirm, 'That code is wrong or has expired.', 400],
    [AUTH_API.login, 'Too many attempts. Please try again later.', 429],
    [AUTH_API.register, 'Choose a stronger password.', 400],
    [AUTH_API.login, 'Reload this page to continue.', 409]]) {
    for (const suppliedReference of ['none', 'header', 'body', 'both']) {
      f.transport(async () => ({
        ...response({ error: text, ...(status === 409 ? { status: 'session-changed' } : {}),
          ...(['body', 'both'].includes(suppliedReference) ? { reference: 'ABCD2345' } : {}) }, status),
        headers: new Headers(['header', 'both'].includes(suppliedReference)
          ? { 'X-CampusIntell-Auth-Reference': 'ABCD2345' } : {}),
      }))
      const tab = f.tab(endpoint + suppliedReference)
      assert.equal(await tab.submit(endpoint, {}), null)
      assert.equal(tab.view().error, text)
    }
  }
}))

test('the intentional switched-off response keeps its text and never shows a reference', async () => fixture(async f => {
  for (const endpoint of Object.values(AUTH_API).filter(endpoint => endpoint !== AUTH_API.session)) {
    f.transport(async () => ({ ...response({ error: AUTH_MESSAGES.comingSoon, reference: 'ABCD2345' }, 503),
      headers: new Headers({ 'X-CampusIntell-Auth-Reference': 'ABCD2345' }) }))
    const tab = f.tab(endpoint)
    assert.equal(await tab.submit(endpoint, {}), null)
    assert.equal(tab.view().error, 'CampusIntell isn’t available right now. Please try again later.')
  }
}))

test('completed-operation instructions never show a reference, including unavailable responses', async () => fixture(async f => {
  for (const [endpoint, error] of [[AUTH_API.confirm, AUTH_MESSAGES.confirmationSignIn],
    [AUTH_API.reset, AUTH_MESSAGES.recoveryRestart], [AUTH_API.verifyRecovery, AUTH_MESSAGES.recoveryRestart]]) {
    for (const status of [400, 503]) {
      f.transport(async () => ({ ...response({ error, reference: 'ABCD2345' }, status),
        headers: new Headers({ 'X-CampusIntell-Auth-Reference': 'ABCD2345' }) }))
      const tab = f.tab(endpoint + status)
      assert.equal(await tab.submit(endpoint, {}), null)
      assert.equal(tab.view().error, error)
    }
  }
}))

test('browser requests abort at exactly 20 seconds even when the transport ignores cancellation', async t => timed(t, async f => {
  assert.equal(AUTH_BROWSER_TIMEOUT_MS, 20_000)
  f.transport(() => new Promise(() => {}))
  const tab = f.tab('A'), pending = tab.submit(AUTH_API.register, {})
  await flush()
  t.mock.timers.tick(19_999); await flush()
  assert.equal(tab.view().pending, true)
  assert.equal(f.requests[0].options.signal.aborted, false)
  t.mock.timers.tick(1)
  assert.equal(await pending, null)
  assert.equal(f.requests[0].options.signal.aborted, true)
  assert.equal(tab.view().error, AUTH_MESSAGES.unavailable)
  assert.equal(tab.view().pending, false)
}))

test('the browser deadline covers a stuck response body without displaying its reference header', async t => timed(t, async f => {
  f.transport(async () => ({ ok: false, status: 503, headers: new Headers({ 'X-CampusIntell-Auth-Reference': 'ABCD2345' }),
    json: () => new Promise(() => {}) }))
  const tab = f.tab('A'), pending = tab.submit(AUTH_API.register, {})
  await flush(); t.mock.timers.tick(20_000)
  assert.equal(await pending, null)
  assert.equal(tab.view().error, AUTH_MESSAGES.unavailable)
  assert.equal(f.requests[0].options.signal.aborted, true)
}))

test('a confirmation timeout checks the live session under the lock and never replays the code', async t => timed(t, async f => {
  f.transport(async endpoint => endpoint === AUTH_API.session ? response({ enabled: true, signedIn: true }) : new Promise(() => {}))
  const tab = f.tab('A'), pending = tab.submit(AUTH_API.confirm, { email: 'student@example.test', code: '123456' })
  await flush(); t.mock.timers.tick(20_000)
  assert.deepEqual(await pending, { next: STUDENT_HOME_PATH })
  assert.deepEqual(f.requests.map(r => [r.endpoint, r.options.method]), [[AUTH_API.confirm, 'POST'], [AUTH_API.session, 'GET']])
  assert.deepEqual(f.notifications, ['A'], 'reconciliation and notification precede lock release')
  assert.equal(tab.view().error, '')
}))

test('a reset timeout checks session state, never infers success from signed-out, and requires fresh recovery', async t => timed(t, async f => {
  const failures = []
  f.transport(async endpoint => endpoint === AUTH_API.session ? response({ enabled: true, signedIn: false }) : new Promise(() => {}))
  const tab = f.tab('A'), pending = tab.submit(AUTH_API.reset, { email: 'student@example.test', password: 'fixture-new-password' }, value => failures.push(value))
  await flush(); t.mock.timers.tick(20_000)
  assert.equal(await pending, null)
  assert.deepEqual(f.requests.map(r => [r.endpoint, r.options.method]), [[AUTH_API.reset, 'POST'], [AUTH_API.session, 'GET']])
  assert.deepEqual(failures, [{ message: AUTH_MESSAGES.unavailable, code: RECOVERY_FAILURE.restart }])
  assert.deepEqual(f.notifications, [])
}))

test('server timeouts also reconcile and preserve completed-operation instructions without a reference', async () => fixture(async f => {
  const failures = []
  f.transport(async endpoint => endpoint === AUTH_API.session ? response({ enabled: true, signedIn: false }) :
    response({ error: AUTH_MESSAGES.confirmationSignIn, reference: 'ABCD2345', status: 'timeout' }, 503))
  const tab = f.tab('A')
  assert.equal(await tab.submit(AUTH_API.confirm, {}, failure => failures.push(failure)), null)
  assert.equal(tab.view().error, AUTH_MESSAGES.confirmationSignIn)
  assert.deepEqual(f.requests.map(r => [r.endpoint, r.options.method]), [[AUTH_API.confirm, 'POST'], [AUTH_API.session, 'GET']])
  assert.equal(failures[0].message, tab.view().error)
}))

test('resend acknowledgment is uniform and makes no delivery claim', () => {
  const { codeSentMessage } = require('./constants.ts')
  for (const email of ['student@example.test', 'absent@example.test']) assert.equal(codeSentMessage(email), 'Check your email for a new code.')
  assert.equal(AUTH_MESSAGES.email, AUTH_MESSAGES.recovery)
})

test('background session checks retain caller cancellation as well as the shared deadline', async () => {
  const originalFetch = global.fetch, caller = new AbortController()
  let transportSignal
  try {
    global.fetch = async (_url, init) => {
      transportSignal = init.signal
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled'))))
    }
    const pending = fetchAuthReply(AUTH_API.session, { signal: caller.signal })
    caller.abort()
    await assert.rejects(pending)
    assert.equal(transportSignal.aborted, true)
  } finally { global.fetch = originalFetch }
})
