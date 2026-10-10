// Execute route outcomes with real request validation and explicit provider envelopes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_MESSAGES, AUTH_API, RECOVERY_FAILURE } = require('./constants.ts')
const { AuthRequestError } = require('./request.ts')
const { parseAuthOutcome } = require('./outcomes.ts')
const email = 'student@example.test'
const user = { id: '00000000-0000-4000-8000-000000000001', email, email_confirmed_at: '2026-09-16T00:00:00Z' }
const verified = () => ({ user, session: { user, access_token: 'fixture-access', refresh_token: 'fixture-refresh' } })

async function invoke(route, options = {}) {
  const original = Module._load, originalError = console.error, env = { ...process.env }, calls = [], diagnostics = []
  const file = require.resolve('../../app/api/auth/' + route + '/route.ts')
  const defaultData = {
    signup: { user: { id: 'new-user' }, session: null }, resend: { user: null, session: null },
    recovery: {}, auth: verified(), verify: verified(),
  }
  const provider = kind => async body => {
    calls.push(['provider', body, kind])
    if (kind === 'verify' && options.recoveryCode && body.type !== 'recovery' && body.type !== 'email') {
      return { data: { user: null, session: null }, error: { code: 'otp_expired' } }
    }
    if (kind === 'verify' && options.signupCode && body.type === 'recovery') {
      return { data: { user: null, session: null }, error: { code: 'otp_expired' } }
    }
    if (kind === 'resend' && route === 'login') {
      if (options.resendThrows) throw new Error('private provider failure')
      return { data: options.resendData === undefined ? defaultData.resend : options.resendData, error: options.resend ?? null }
    }
    if (options.throws) throw new Error('private provider failure')
    return { data: options.data === undefined ? defaultData[kind] : options.data, error: options.error ?? null }
  }
  const mocks = {
    '@/lib/auth/student-state': { rejectExistingStudent: async () => null },
    '@/lib/auth/rate-limit': { consumeAuthLimit: async action => {
      if (options.limit || (options.resendLimit && action === 'RESEND_CONFIRMATION')) throw new AuthRequestError(429, AUTH_MESSAGES.limited)
    } },
    '@/lib/supabase/auth-gateway': { getAuthGateway: () => ({
      signUp: provider('signup'), resend: provider('resend'), resetPasswordForEmail: provider('recovery'),
      signInWithPassword: provider('auth'), verifyOtp: provider('verify'),
    }) },
    '@/lib/supabase/server': { createClient: async response => ({ auth: {
      setSession: async () => {
        calls.push(['transfer'])
        response.cookies.set('sb-fixture-auth-token', 'fixture-cookie', { httpOnly: true })
        return options.transfer ?? { data: verified(), error: null }
      },
      getClaims: async () => ({ data: null, error: options.lookupError ?? null }),
      signOut: async () => { calls.push(['logout']); return { error: options.error ?? null } },
    } }) },
    // These tests isolate provider outcomes; the real session/continuity boundary is covered separately.
    '@/lib/auth/mutation-context': { getAuthenticatedMutationContext: async (response, token) => {
      assert.equal(token, 'fixture-flow')
      const client = await mocks['@/lib/supabase/server'].createClient(response)
      const { error } = await client.auth.getClaims()
      return error ? { status: 'unavailable' } : { status: 'ready', context: { client, user, sessionId: 'fixture-session' } }
    } },
    '@/lib/analytics/server': {
      recordConfirmedSignup: async () => { calls.push(['analytics', 'signup_confirmed']) },
      recordSuccessfulLogin: async () => { calls.push(['analytics', 'login_succeeded']) },
    },
    '@/lib/auth/recovery-grant': {
      discardRecoveryGrant: async () => { calls.push(['discard']); if (options.storeError) throw new Error('private store failure') },
      clearRecoveryCookie: response => response.cookies.set('ci-recovery-grant', '', { maxAge: 0 }),
      issueRecoveryGrant: async () => { calls.push(['issue']); if (options.issueError) throw new Error('private store failure') },
    },
    '@/lib/supabase/recovery-auth': { getRecoveryAuthGateway: () => ({ revokeTemporarySession: async () => { calls.push(['revoke']); if (options.revokeError) throw new Error('private revocation failure') } }) },
  }
  const defaults = {
    register: { email, password: 'fixture-password' }, login: { email, password: 'fixture-password' },
    'confirm-email': { email, code: '123456' }, 'verify-recovery': { email, code: '123456' },
    'forgot-password': { email }, 'resend-confirmation': { email }, logout: {}, 'cancel-recovery': {},
  }
  try {
    console.error = (...args) => diagnostics.push(args)
    Object.assign(process.env, { STUDENT_AUTH_ENABLED: options.disabled ? 'false' : 'true', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      ...options.environment })
    Module._load = function(name, ...args) { return mocks[name] || original.call(this, name, ...args) }
    delete require.cache[file]
    const requestOrigin = options.requestOrigin ?? 'http://localhost:3000'
    const response = await require(file).POST(new Request(requestOrigin + '/api/auth/' + route, {
      method: 'POST', headers: { origin: options.origin ?? requestOrigin, 'content-type': 'application/json',
        ...(route === 'logout' ? { 'x-campus-account-continuity': 'fixture-flow' } : {}), ...options.headers },
      body: JSON.stringify(options.body ?? defaults[route]),
    }))
    const body = await response.json()
    assert.doesNotMatch(JSON.stringify(body), /fixture-access|fixture-refresh|private|identities|student@example/)
    if (response.status !== 200) assert.ok(response.cookies.getAll().every(cookie => !cookie.value))
    return { status: response.status, body, calls, response, diagnostics }
  } finally {
    console.error = originalError
    Module._load = original; delete require.cache[file]
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

test('new, unconfirmed and obfuscated confirmed signup authorize identical transitions, never sessions', async () => {
  const fixtures = [
    { user: { id: 'new-user', identities: [{ provider: 'email' }], confirmation_sent_at: '2026-09-16' }, session: null },
    { user: { id: 'unconfirmed-user', identities: [{ provider: 'email' }], confirmation_sent_at: '2026-09-16' }, session: null },
    { user: { id: 'fake-user', identities: [], confirmation_sent_at: '2026-09-16' }, session: null },
  ]
  for (const data of fixtures) {
    const result = await invoke('register', { data })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { message: AUTH_MESSAGES.email })
    assert.equal(result.response.cookies.getAll().length, 0)
    assert.equal(result.calls.some(c => c[0] === 'transfer'), false)
  }
  for (const data of [null, {}, { user: null, session: null }, verified()]) {
    assert.equal((await invoke('register', { data })).status, 503)
  }
})

// Provider envelopes as the repository's GoTrue v2.196.0 emits them; text is classified, never forwarded.
const PROVIDER = {
  cooldown: { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' },
  quota: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
  request: { code: 'over_request_rate_limit', message: 'Request rate limit reached' },
  sendFailure: { code: 'unexpected_failure', message: 'Error sending confirmation email' },
  disabled: { code: 'email_provider_disabled', message: 'Email logins are disabled' },
}

/* Every email/code initiation route, pinned per outcome:
 * status, stay/advance (the client advances only on HTTP 200), outward message category,
 * session state (never changes on initiation) and whether a usable code is expected. */
const INITIATION_MATRIX = [
  { label: 'accepted initiation', options: {}, status: 200, advance: true, category: 'neutral', delivery: 'expected' },
  { label: 'application rate limit', options: { limit: true }, status: 429, advance: false, category: 'limited', delivery: 'none' },
  { label: 'provider request rate limit (pre-handler)', options: { error: PROVIDER.request }, status: 429, advance: false, category: 'limited', delivery: 'none' },
  { label: 'provider send quota exhausted (pre-transport)', options: { error: PROVIDER.quota }, status: 429, advance: false, category: 'limited', delivery: 'none' },
  { label: 'provider generic HTTP 429', options: { error: { status: 429, code: 'future_rate_limit' } }, status: 429, advance: false, category: 'limited', delivery: 'none' },
  { label: 'provider recipient cooldown', options: { error: PROVIDER.cooldown }, status: 200, advance: true, category: 'neutral', delivery: 'recent' },
  { label: 'provider email-send failure', options: { error: PROVIDER.sendFailure }, status: 200, advance: true, category: 'neutral', delivery: 'none' },
  { label: 'provider email disabled', options: { error: PROVIDER.disabled }, status: 200, advance: true, category: 'neutral', delivery: 'none' },
  { label: 'unrecognized provider failure', options: { error: { code: 'private_unknown', message: 'private provider failure' } }, status: 200, advance: true, category: 'neutral', delivery: 'none' },
  { label: 'provider transport exception', options: { throws: true }, status: 200, advance: true, category: 'neutral', delivery: 'none' },
  ...['user_already_exists', 'email_exists', 'user_not_found', 'email_not_confirmed'].map(code => ({
    label: 'enumeration-sensitive outcome ' + code, options: { error: { code, message: 'private account state' } },
    status: 200, advance: true, category: 'neutral', delivery: 'none',
  })),
]

test('email initiation matrix: every route pins status, progression, message category, session and delivery', async () => {
  const provider = /For security purposes|rate limit|Request rate|private|Error sending|logins are disabled/i
  for (const route of ['register', 'resend-confirmation', 'forgot-password']) {
    const neutral = route === 'forgot-password' ? AUTH_MESSAGES.recovery : AUTH_MESSAGES.email
    for (const row of INITIATION_MATRIX) {
      const expected = row
      const r = await invoke(route, row.options)
      assert.equal(r.status, expected.status, route + ': ' + row.label)
      assert.equal(r.status === 200, expected.advance, route + ': ' + row.label)
      assert.deepEqual(r.body, expected.category === 'neutral' ? { message: neutral } :
        { error: expected.category === 'limited' ? AUTH_MESSAGES.limited : AUTH_MESSAGES.unavailable }, route + ': ' + row.label)
      assert.doesNotMatch(JSON.stringify(r.body), provider)
      assert.equal(r.response.cookies.getAll().filter(c => c.value).length, 0)
      assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
      // A throttle that sent nothing never reaches the provider or stops before any send is claimed.
      if (row.options.limit) assert.equal(r.calls.some(c => c[0] === 'provider'), false)
      if (expected.status === 200) assert.ok(['expected', 'recent', 'none'].includes(expected.delivery))
      else assert.ok(['none', 'not-guaranteed'].includes(expected.delivery))
    }
  }
  // A password-authenticated unconfirmed login uses the same neutral resend contract.
  for (const row of INITIATION_MATRIX) {
    const r = await invoke('login', { error: { code: 'email_not_confirmed' }, resend: row.options.error,
      resendLimit: row.options.limit, resendThrows: row.options.throws })
    assert.equal(r.status, row.status, 'login: ' + row.label)
    assert.equal(r.status === 200, row.advance, 'login: ' + row.label)
    assert.deepEqual(r.body, row.category === 'neutral' ? { code: 'EMAIL_CONFIRMATION_REQUIRED' } :
      { error: row.category === 'limited' ? AUTH_MESSAGES.limited : AUTH_MESSAGES.unavailable }, 'login: ' + row.label)
    assert.equal(r.response.cookies.getAll().filter(c => c.value).length, 0)
    assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
    if (row.options.limit) assert.equal(r.calls.filter(c => c[2] === 'resend').length, 0)
  }
  // Every SDK success envelope is validated before it can authorize a UI transition.
  for (const data of [null, {}, { user: null, session: null }, verified(), { user: { id: 'new-user' }, session: null, extra: true }]) {
    assert.equal((await invoke('register', { data })).status, 503)
  }
  for (const data of [null, {}, [], verified(), { user: null, session: null, extra: true }]) {
    assert.equal((await invoke('resend-confirmation', { data })).status, 503)
    assert.equal((await invoke('login', { error: { code: 'email_not_confirmed' }, resendData: data })).status, 503)
  }
  for (const data of [null, [], verified(), { unexpected: true }]) {
    assert.equal((await invoke('forgot-password', { data })).status, 503)
  }
  const weak = await invoke('register', { error: { code: 'weak_password' } })
  assert.equal(weak.status, 400); assert.deepEqual(weak.body, { error: AUTH_MESSAGES.signupPassword })
  for (const route of ['resend-confirmation', 'forgot-password']) assert.equal((await invoke(route, { error: { code: 'weak_password' } })).status, 200)
  const invalid = await invoke('register', { body: { email, password: 'short' } })
  assert.equal(invalid.status, 400); assert.equal(invalid.calls.length, 0)
  for (const route of ['register', 'resend-confirmation', 'forgot-password']) assert.equal((await invoke(route, { body: { email: 'invalid' } })).status, 400)
})

/* Recovery initiation, pinned per outcome. GoTrue answers a nonexistent recipient with a silent 200 and
 * emits the per-recipient cooldown only after finding the account, so those rows must stay outwardly identical
 * to an accepted send, including delivery failures; recipient-independent limits remain rejections. */
const RECOVERY_MATRIX = [
  { label: 'accepted recovery initiation', options: {}, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'nonexistent recipient provider no-op', options: { data: {} }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'existing recipient cooldown', options: { error: PROVIDER.cooldown }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'application rate limit', options: { limit: true }, status: 429, advance: false, session: 'none', delivery: 'none', existence: 'attempt-history' },
  { label: 'provider request limit (pre-lookup)', options: { error: PROVIDER.request }, status: 429, advance: false, session: 'none', delivery: 'none', existence: 'hidden' },
  { label: 'provider send quota (pre-lookup)', options: { error: PROVIDER.quota }, status: 429, advance: false, session: 'none', delivery: 'none', existence: 'hidden' },
  { label: 'delivery/provider failure', options: { error: PROVIDER.sendFailure }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'email provider disabled', options: { error: PROVIDER.disabled }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'malformed success envelope', options: { data: { unexpected: true } }, status: 503, advance: false, session: 'none', delivery: 'none', existence: 'hidden' },
  { label: 'unexpected provider failure', options: { error: { code: 'private_unknown', message: 'private provider failure' } }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
  { label: 'provider transport exception', options: { throws: true }, status: 200, advance: true, session: 'none', delivery: 'conditional', existence: 'hidden' },
]

test('recovery initiation matrix: accepted, no-op, cooldown and delivery failure are indistinguishable', async () => {
  const outward = r => ({ status: r.status, body: r.body, cookies: r.response.cookies.getAll().map(c => [c.name, c.value, c.maxAge]) })
  const neutral = []
  for (const row of RECOVERY_MATRIX) {
    const r = await invoke('forgot-password', row.options)
    assert.equal(r.status, row.status, row.label)
    assert.equal(r.status === 200, row.advance, row.label)
    assert.deepEqual(r.body, row.status === 200 ? { message: AUTH_MESSAGES.recovery } :
      { error: row.status === 429 ? AUTH_MESSAGES.limited : AUTH_MESSAGES.unavailable }, row.label)
    assert.doesNotMatch(JSON.stringify(r.body), /For security purposes|rate limit|Request rate|private|Error sending|logins are disabled/i)
    // Initiation never publishes a student session or a recovery grant; only a cleared grant cookie may appear.
    assert.equal(row.session, 'none')
    assert.ok(r.response.cookies.getAll().every(c => !c.value), row.label)
    assert.equal(r.calls.some(c => c[0] === 'issue' || c[0] === 'transfer'), false, row.label)
    if (row.options.limit) assert.equal(r.calls.some(c => c[0] === 'provider'), false, row.label)
    if (row.status === 200) { assert.equal(row.delivery, 'conditional'); assert.equal(row.existence, 'hidden'); neutral.push(outward(r)) }
    else assert.equal(row.delivery, 'none')
  }
  assert.equal(neutral.length, 7)
  for (const result of neutral) assert.deepEqual(result, neutral[0])
})

test('recovery outage cannot distinguish an existing recipient from a nonexistent provider no-op', async () => {
  const view = r => ({ status: r.status, body: r.body, headers: Object.fromEntries(r.response.headers),
    cookies: r.response.cookies.getAll(), writes: r.calls.filter(c => ['issue', 'transfer', 'analytics'].includes(c[0])) })
  const absent = await invoke('forgot-password', { data: {} })
  assert.deepEqual(absent.body, { message: 'If an account can receive a password reset email, instructions will arrive shortly.' })
  for (const options of [{ data: null, error: PROVIDER.sendFailure }, { throws: true }]) {
    const existing = await invoke('forgot-password', options)
    assert.deepEqual(view(existing), view(absent))
    assert.equal(existing.status, 200)
    assert.deepEqual(existing.diagnostics, [['CampusIntell auth email initiation', {
      action: 'recovery', outcome: options.throws ? 'exception' : 'failed',
    }]])
  }
})

test('signup and resend hide the same delivery distinction without granting a session', async () => {
  for (const [route, data] of [
    ['register', { user: { id: 'obfuscated-confirmed-user', identities: [] }, session: null }],
    ['resend-confirmation', { user: null, session: null }],
  ]) {
    const noSend = await invoke(route, { data })
    for (const options of [{ data: null, error: PROVIDER.sendFailure }, { throws: true }]) {
      const failedSend = await invoke(route, options)
      assert.equal(failedSend.status, 200)
      assert.deepEqual(failedSend.body, { message: 'If this address can receive a confirmation email, instructions will arrive shortly.' })
      assert.deepEqual(failedSend.body, noSend.body)
      assert.deepEqual(Object.fromEntries(failedSend.response.headers), Object.fromEntries(noSend.response.headers))
      assert.deepEqual(failedSend.response.cookies.getAll(), [])
      assert.equal(failedSend.calls.some(c => ['issue', 'transfer', 'analytics'].includes(c[0])), false)
    }
  }
})

test('login/confirmation require matching confirmed identity and completed cookie transfer', async () => {
  for (const route of ['login', 'confirm-email']) {
    const success = await invoke(route)
    assert.equal(success.status, 200); assert.deepEqual(success.body, { next: '/dashboard' })
    assert.equal(success.response.cookies.get('sb-fixture-auth-token').httpOnly, true)
    for (const data of [null, {}, { user, session: null }, { ...verified(), user: { ...user, email: 'other@example.test' } },
      { ...verified(), user: { ...user, email_confirmed_at: null } },
      { ...verified(), session: { ...verified().session, user: { ...user, id: 'different' } } }]) {
      const r = await invoke(route, { data })
      assert.equal(r.status, 503); assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
    }
    for (const transfer of [{ data: null, error: null }, { data: verified(), error: { code: 'unexpected_failure' } },
      { data: { ...verified(), user: { ...user, id: 'different' } }, error: null }]) {
      const r = await invoke(route, { transfer })
      assert.equal(r.status, 503)
      assert.deepEqual(r.body, { error: route === 'confirm-email' ? AUTH_MESSAGES.confirmationSignIn : AUTH_MESSAGES.unavailable })
    }
    for (const options of [{ throws: true }, { error: { code: 'unexpected_failure' } }, { limit: true }]) {
      assert.equal((await invoke(route, options)).status, options.limit ? 429 : 503)
    }
  }
})

test('normal account login returns an operator to /admin without broadening redirect paths', async () => {
  const operator = await invoke('login', { body: { email, password: 'fixture-password', next: '/admin' } })
  assert.equal(operator.status, 200)
  assert.deepEqual(operator.body, { next: '/admin' })
  assert.equal(operator.response.cookies.get('sb-fixture-auth-token').httpOnly, true)
  for (const next of ['/admin/settings', 'https://evil.test', '//evil.test']) {
    const rejected = await invoke('login', { body: { email, password: 'fixture-password', next } })
    assert.equal(rejected.status, 200)
    assert.deepEqual(rejected.body, { next: '/dashboard' })
  }
})

test('signup and login events follow completed session transfer, never initiation or failure', async () => {
  for (const [route, name] of [['confirm-email', 'signup_confirmed'], ['login', 'login_succeeded']]) {
    const success = await invoke(route)
    assert.equal(success.status, 200)
    assert.deepEqual(success.calls.filter(call => call[0] === 'transfer' || call[0] === 'analytics'),
      [['transfer'], ['analytics', name]])
    for (const options of [
      { error: { code: 'invalid_credentials' } },
      { data: { ...verified(), user: { ...user, email_confirmed_at: null } } },
      { transfer: { data: verified(), error: { code: 'unexpected_failure' } } },
      { transfer: { data: { ...verified(), user: { ...user, id: 'different' } }, error: null } },
      { limit: true },
    ]) {
      const failure = await invoke(route, options)
      assert.notEqual(failure.status, 200)
      assert.equal(failure.calls.some(call => call[0] === 'analytics'), false)
    }
  }
  for (const route of ['register', 'resend-confirmation', 'forgot-password']) {
    const initiation = await invoke(route)
    assert.equal(initiation.status, 200)
    assert.equal(initiation.calls.some(call => call[0] === 'analytics'), false)
  }
  const unconfirmedLogin = await invoke('login', { error: { code: 'email_not_confirmed' } })
  assert.equal(unconfirmedLogin.status, 200)
  assert.equal(unconfirmedLogin.calls.some(call => call[0] === 'analytics'), false)
})

test('wrong credentials and wrong/expired/consumed confirmation codes cannot create sessions', async () => {
  const invalid = await invoke('login', { error: { code: 'invalid_credentials' } })
  assert.equal(invalid.status, 400); assert.deepEqual(invalid.body, { error: AUTH_MESSAGES.credentials })
  const banned = await invoke('login', { error: { code: 'user_banned' } })
  assert.equal(banned.status, invalid.status); assert.deepEqual(banned.body, invalid.body)
  for (const route of ['confirm-email', 'verify-recovery']) {
    const r = await invoke(route, { error: { code: 'user_banned' } })
    assert.equal(r.status, 400); assert.deepEqual(r.body, { error: AUTH_MESSAGES.code })
  }
  for (const reason of ['wrong', 'expired', 'consumed']) {
    const r = await invoke('confirm-email', { error: { code: 'otp_expired', message: reason } })
    assert.equal(r.status, 400); assert.deepEqual(r.body, { error: AUTH_MESSAGES.code })
    assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
  }
  for (const route of ['login', 'confirm-email']) {
    assert.equal((await invoke(route, { error: { code: 'over_request_rate_limit' } })).status, 429)
  }
})

test('recovery code cannot be exchanged through the confirmation endpoint for a student session', async () => {
  const r = await invoke('confirm-email', { recoveryCode: true })
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: AUTH_MESSAGES.code })
  assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
  assert.equal(r.calls.find(c => c[0] === 'provider')[1].type, 'signup')
  const recovery = await invoke('verify-recovery', { recoveryCode: true })
  assert.deepEqual(recovery.body, { verified: true })
  assert.deepEqual(recovery.calls.map(c => c[0]), ['discard', 'provider', 'revoke', 'issue'])
  const wrongPurpose = await invoke('verify-recovery', { signupCode: true })
  assert.equal(wrongPurpose.status, 400)
  assert.equal(wrongPurpose.calls.some(c => c[0] === 'issue'), false)
  assert.equal(wrongPurpose.calls.find(c => c[0] === 'provider')[1].type, 'recovery')
})

test('recovery verification failures never claim a grant; post-consumption failures require restart', async () => {
  for (const options of [{ data: { user, session: null } }, { data: { ...verified(), user: { ...user, email: 'other@example.test' } } }, { revokeError: true }, { issueError: true }]) {
    const r = await invoke('verify-recovery', options)
    assert.equal(r.status, 503); assert.equal(r.body.code, RECOVERY_FAILURE.restart)
    assert.equal(r.calls.some(c => c[0] === 'transfer'), false)
  }
  for (const options of [{ throws: true }, { storeError: true }, { error: { code: 'unexpected_failure' } }, { limit: true }]) {
    const r = await invoke('verify-recovery', options)
    assert.equal(r.status, options.limit ? 429 : 503)
    assert.equal(r.calls.some(c => c[0] === 'issue'), false)
  }
})

test('logout and cancellation require successful lookup/revocation/store operation', async () => {
  for (const options of [{ lookupError: { code: 'unexpected_failure' } }, { error: { code: 'unexpected_failure' } }, { storeError: true }]) {
    const r = await invoke('logout', options)
    assert.equal(r.status, 503); assert.deepEqual(r.body, { error: AUTH_MESSAGES.unavailable })
    if (options.lookupError) assert.equal(r.calls.some(c => c[0] === 'logout'), false)
  }
  for (const route of ['logout', 'cancel-recovery']) {
    assert.deepEqual((await invoke(route)).body, { success: true })
    assert.equal((await invoke(route, { storeError: true })).status, 503)
  }
})

test('all covered POST flows reject disabled rollout/cross-origin/malformed input before provider work', async () => {
  for (const route of ['register', 'login', 'confirm-email', 'resend-confirmation', 'forgot-password', 'verify-recovery', 'logout', 'cancel-recovery']) {
    for (const [options, status] of [[{ disabled: true }, 503], [{ origin: 'https://other.test' }, 403], [{ body: { unexpected: true } }, 400]]) {
      const r = await invoke(route, options)
      assert.equal(r.status, status); assert.equal(r.calls.length, 0)
    }
  }
})

test('all covered auth POST flows share exact current Preview trust and reject other deployments before provider work', async () => {
  const preview = 'https://preview-current.vercel.app'
  const options = { requestOrigin: preview,
    environment: { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'preview-current.vercel.app',
      NEXT_PUBLIC_SITE_URL: 'https://campusintel.test' },
    headers: { 'x-vercel-forwarded-for': '203.0.113.42', 'sec-fetch-site': 'same-origin' } }
  for (const route of ['register', 'login', 'confirm-email', 'resend-confirmation', 'forgot-password', 'verify-recovery', 'reset-password', 'logout', 'cancel-recovery']) {
    // Reset remains grant-protected; invalid input proves origin acceptance without granting recovery access.
    const requestOptions = route === 'reset-password' ? { ...options, body: { unexpected: true } } : options
    const accepted = await invoke(route, requestOptions)
    assert.equal(accepted.status, route === 'reset-password' ? 400 : 200, route + ': the current deployment passes the origin guard')
    if (route === 'reset-password') assert.equal(accepted.calls.length, 0)
    const rejected = await invoke(route, { ...requestOptions, origin: 'https://preview-other.vercel.app' })
    assert.equal(rejected.status, 403, route + ': another deployment cannot proceed')
    assert.equal(rejected.calls.length, 0, route + ': rejection precedes provider/session work')
  }
  const login = await invoke('login', options)
  assert.deepEqual(login.body, { next: '/dashboard' })
  assert.equal(login.calls.filter(call => call[0] === 'transfer').length, 1)
})

test('every client endpoint rejects success-shaped but unauthorized outcomes', () => {
  const valid = {
    [AUTH_API.register]: { message: AUTH_MESSAGES.email }, [AUTH_API.resend]: { message: AUTH_MESSAGES.email },
    [AUTH_API.forgot]: { message: AUTH_MESSAGES.recovery }, [AUTH_API.login]: { next: '/courses' },
    [AUTH_API.confirm]: { next: '/courses' }, [AUTH_API.verifyRecovery]: { verified: true },
    [AUTH_API.reset]: { next: '/login?state=password-reset' }, [AUTH_API.logout]: { success: true },
    [AUTH_API.cancelRecovery]: { success: true },
  }
  for (const [endpoint, value] of Object.entries(valid)) {
    assert.deepEqual(parseAuthOutcome(endpoint, value), value)
    for (const bad of [{}, [], null, { error: AUTH_MESSAGES.unavailable }, { ...value, error: AUTH_MESSAGES.unavailable }, { ...value, access_token: 'unexpected' }]) {
      assert.throws(() => parseAuthOutcome(endpoint, bad))
    }
  }
  assert.deepEqual(parseAuthOutcome(AUTH_API.login, { code: 'EMAIL_CONFIRMATION_REQUIRED' }), { code: 'EMAIL_CONFIRMATION_REQUIRED' })
  for (const delivery of ['accepted', 'limited', 'failed']) assert.throws(() => parseAuthOutcome(AUTH_API.login, { code: 'EMAIL_CONFIRMATION_REQUIRED', delivery }))
  for (const next of ['', '//evil.test', 'https://evil.test', '/login', '/api/auth/logout']) assert.throws(() => parseAuthOutcome(AUTH_API.login, { next }))
  assert.throws(() => parseAuthOutcome(AUTH_API.confirm, { code: 'EMAIL_CONFIRMATION_REQUIRED', delivery: 'accepted' }))
})
