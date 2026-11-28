const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTH_API, AUTH_MESSAGES, PASSWORD_RESET_DESTINATION, EXISTING_STUDENT_SESSION, STUDENT_HOME_PATH } = require('./constants.ts')
const { fixture, deferred, response, success } = require('./auth-transition-fixture.cjs')

async function recoveryCookieRace(f, firstEndpoint, firstOutcome, firstStatus) {
  const a = f.tab('A'), b = f.tab('B'), started = deferred(), network = deferred(), parsing = deferred(), body = deferred()
  const jar = { recovery: 'credential-A', studentSession: null }
  const grants = new Map([['credential-A', 'a@example.test']]), cookiesSent = [], failures = []
  f.transport(async (endpoint, options, document) => {
    assert.equal(options.credentials, 'same-origin')
    cookiesSent.push([document, jar.recovery])
    if (document === 'A') {
      assert.equal(endpoint, firstEndpoint)
      assert.equal(grants.get(jar.recovery), 'a@example.test')
      grants.delete(jar.recovery) // Matching A grant consumed/discarded at request time.
      started.resolve(); await network.promise
      jar.recovery = null // Browser applies A's deletion before response.json().
      f.events.push(['cookie-clear', 'A'])
      return { ok: firstStatus === 200, status: firstStatus, json: async () => { parsing.resolve(); return body.promise } }
    }
    assert.equal(endpoint, AUTH_API.verifyRecovery)
    assert.equal(jar.recovery, null, 'A deletion has already completed before B starts')
    grants.set('credential-B', 'b@example.test')
    jar.recovery = 'credential-B' // Browser applies the new HttpOnly cookie before parsing B.
    f.events.push(['cookie-install', 'B'])
    return response({ verified: true })
  })
  const first = a.submit(firstEndpoint, firstEndpoint === AUTH_API.reset
    ? { email: 'a@example.test', password: 'fixture-new-password' }
    : { email: 'a@example.test', code: '999999' }, failure => failures.push(failure))
  await started.promise
  const second = b.submit(AUTH_API.verifyRecovery, { email: 'b@example.test', code: '123456' })
  assert.deepEqual(f.requests.map(request => request.document), ['A'])
  assert.equal(b.view().pending, true)
  assert.equal(await b.submit(AUTH_API.verifyRecovery, {}), null, 'queued hook suppresses duplicate submission')
  assert.equal(grants.has('credential-A'), false)
  network.resolve(); await parsing.promise
  assert.equal(jar.recovery, null)
  assert.equal(f.requests.length, 1, 'B still sends zero requests after cookie deletion while A JSON is pending')
  assert.deepEqual(f.notifications, [])
  body.resolve(firstOutcome)
  const firstResult = await first
  assert.deepEqual(firstResult, firstStatus === 200 ? firstOutcome : null)
  assert.deepEqual(await second, { verified: true })
  assert.deepEqual(cookiesSent, [['A', 'credential-A'], ['B', null]])
  assert.equal(jar.recovery, 'credential-B')
  assert.equal(grants.get(jar.recovery), 'b@example.test', 'B still has its usable grant and credential')
  assert.equal(jar.studentSession, null)
  assert.deepEqual(f.notifications, firstEndpoint === AUTH_API.reset ? ['A'] : [])
  if (firstStatus !== 200) {
    assert.equal(a.view().error, AUTH_MESSAGES.recoveryCode)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].message, AUTH_MESSAGES.recoveryCode)
  }
  const event = (name, document) => f.events.findIndex(value => value[0] === name && value[1] === document)
  assert.ok(event('cookie-clear', 'A') < event('release', 'A'))
  assert.ok(event('release', 'A') < event('fetch', 'B'))
  assert.ok(event('fetch', 'B') < event('cookie-install', 'B'))
  assert.equal(f.requests.length, 2, 'no retry or late competing A response')
  assert.equal(a.view().pending, false); assert.equal(b.view().pending, false)
}

test('reset A deletion finishes before verify B can fetch or install its newer recovery cookie, including held JSON', async () =>
  fixture(f => recoveryCookieRace(f, AUTH_API.reset, { next: PASSWORD_RESET_DESTINATION }, 200)))

test('wrong-code verify A deletion finishes before verify B; B cookie survives and neither verification notifies student change', async () =>
  fixture(f => recoveryCookieRace(f, AUTH_API.verifyRecovery, { error: AUTH_MESSAGES.recoveryCode }, 400)))

test('forgot and cancel share the same response lock with verification in both directions without student notifications', async () => {
  for (const endpoint of [AUTH_API.forgot, AUTH_API.cancelRecovery]) {
    for (const [firstEndpoint, secondEndpoint] of [[AUTH_API.verifyRecovery, endpoint], [endpoint, AUTH_API.verifyRecovery]]) {
      await fixture(async f => {
        const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
        f.transport(async (operation, _, document) => {
          if (document === 'A') { started.resolve(); await release.promise }
          return response(success(operation))
        })
        const first = a.submit(firstEndpoint, {}); await started.promise
        const second = b.submit(secondEndpoint, {})
        assert.deepEqual(f.requests.map(request => request.endpoint), [firstEndpoint])
        assert.equal(b.view().pending, true)
        release.resolve()
        assert.deepEqual(await first, success(firstEndpoint)); assert.deepEqual(await second, success(secondEndpoint))
        assert.deepEqual(f.requests.map(request => request.endpoint), [firstEndpoint, secondEndpoint])
        assert.deepEqual(f.notifications, [])
        const locks = f.events.filter(event => event[0] === 'request-lock')
        assert.equal(locks.length, 2)
        assert.ok(locks.every(event => event[2] === 'campusintell:student-auth-transition:v1' && event[3] === 'exclusive'))
      })
    }
  }
})

test('verification and login honor first admission and the queued request carries the resulting session', async () => {
  for (const firstEndpoint of [AUTH_API.login, AUTH_API.verifyRecovery]) await fixture(async f => {
    const secondEndpoint = firstEndpoint === AUTH_API.login ? AUTH_API.verifyRecovery : AUTH_API.login
    const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
    const jar = { session: null }, cookiesSent = []
    f.transport(async (endpoint, _, document) => {
      cookiesSent.push([document, jar.session])
      if (document === 'A') { started.resolve(); await release.promise }
      if (endpoint === AUTH_API.verifyRecovery && jar.session) {
        return response({ code: EXISTING_STUDENT_SESSION, next: STUDENT_HOME_PATH }, 409)
      }
      if (endpoint === AUTH_API.login) jar.session = document
      return response(success(endpoint))
    })
    const first = a.submit(firstEndpoint, {}); await started.promise
    const second = b.submit(secondEndpoint, {})
    assert.equal(f.requests.length, 1); assert.equal(b.view().pending, true)
    release.resolve()
    assert.deepEqual(await first, success(firstEndpoint))
    assert.deepEqual(await second, firstEndpoint === AUTH_API.login ? null : success(secondEndpoint))
    assert.deepEqual(cookiesSent, [['A', null], ['B', firstEndpoint === AUTH_API.login ? 'A' : null]])
    assert.equal(jar.session, firstEndpoint === AUTH_API.login ? 'A' : 'B')
    assert.deepEqual(f.notifications, [firstEndpoint === AUTH_API.login ? 'A' : 'B'])
    assert.deepEqual(f.redirects, firstEndpoint === AUTH_API.login ? [['B', STUDENT_HOME_PATH]] : [])
  })
})

test('ordered recovery failures release a waiting document without retries or student notifications', async () => {
  const failures = [
    () => response({ error: AUTH_MESSAGES.invalid }, 400),
    () => response({ error: AUTH_MESSAGES.recoveryCode }, 400),
    () => response({ error: AUTH_MESSAGES.limited }, 429),
    () => response({ error: AUTH_MESSAGES.unavailable }, 503),
    () => response({ verified: false }),
    () => response({ verified: true, access_token: 'unexpected-private-field' }),
    () => ({ ok: true, status: 200, json: async () => { throw new Error('unreadable JSON') } }),
    () => { throw new Error('network failure') },
  ]
  for (const failure of failures) await fixture(async f => {
    const started = deferred(), release = deferred(), a = f.tab('A'), b = f.tab('B')
    f.transport(async (_, __, document) => {
      if (document === 'A') { started.resolve(); await release.promise; return failure() }
      return response({ success: true })
    })
    const first = a.submit(AUTH_API.verifyRecovery, {}); await started.promise
    const second = b.submit(AUTH_API.cancelRecovery, {})
    assert.equal(f.requests.length, 1)
    release.resolve()
    assert.equal(await first, null); assert.deepEqual(await second, { success: true })
    assert.equal(f.requests.length, 2); assert.deepEqual(f.notifications, [])
    assert.equal(a.view().pending, false); assert.equal(b.view().pending, false)
    assert.ok(Object.values(AUTH_MESSAGES).includes(a.view().error))
  })
})
