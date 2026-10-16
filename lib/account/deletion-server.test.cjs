const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache)), originalError = console.error
  const user = { id: randomUUID(), email: randomUUID() + '@example.test', email_confirmed_at: '2026-10-16T00:00:00Z' }
  const token = randomUUID(), proofId = randomUUID(), sessionId = randomUUID(), password = randomUUID()
  const scheduled = { status: 'scheduled', deadline: '2026-11-15T00:00:00Z', requestId: randomUUID() }
  const state = {
    data: { user, session: { user, access_token: token, refresh_token: randomUUID() } },
    claims: { sub: user.id, session_id: proofId }, claimError: null, providerError: null,
    result: { data: scheduled, error: null }, rpcThrows: null, cleanupThrows: false,
  }
  const calls = [], diagnostics = []
  try {
    console.error = (...values) => diagnostics.push(values)
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config') return {
        getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'fixture-publishable' }),
        getAuthSecretKey: () => 'fixture-service',
      }
      if (name === '@/lib/supabase/auth-gateway') return { getAuthGateway: address => ({ signInWithPassword: async input => {
        assert.equal(address, 'local'); assert.deepEqual(input, { email: user.email, password })
        calls.push('password'); return { data: state.data, error: state.providerError }
      } }) }
      if (name === '@supabase/supabase-js') return { createClient: (_url, key, options) => {
        assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false)
        assert.equal(options.auth.detectSessionInUrl, false)
        return key === 'fixture-service' ? { rpc: async (operation, input) => {
          calls.push('schedule'); assert.equal(operation, 'schedule_student_deletion')
          assert.deepEqual(input, { p_session_id: sessionId, p_verified_session_id: proofId })
          if (state.rpcThrows) throw state.rpcThrows
          return state.result
        } } : { auth: { getClaims: async supplied => {
          calls.push('claims'); assert.equal(supplied, token)
          assert.equal(options.global.headers.Authorization, 'Bearer ' + token)
          return { data: { claims: state.claims }, error: state.claimError }
        } } }
      } }
      if (name === '@/lib/supabase/recovery-auth') return { getRecoveryAuthGateway: address => ({ revokeTemporarySession: async supplied => {
        assert.equal(address, 'local'); assert.equal(supplied, token); calls.push('cleanup')
        if (state.cleanupThrows) throw new Error('private cleanup detail ' + token)
      } }) }
      return load.call(this, name, ...args)
    }
    delete require.cache[require.resolve('./deletion-server.ts')]
    const { scheduleStudentDeletion } = require('./deletion-server.ts')
    await run({ state, calls, diagnostics, user, token, scheduled,
      schedule: () => scheduleStudentDeletion({ user, sessionId }, password, 'local') })
  } finally {
    console.error = originalError; Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('proof cleanup runs when verified-session parsing rejects a provider envelope that contains an access token', async () => fixture(async f => {
  const valid = f.state.data
  const invalid = [
    { ...valid, user: { ...f.user, email_confirmed_at: undefined } },
    { ...valid, user: { ...f.user, id: randomUUID() } },
    { ...valid, session: { ...valid.session, refresh_token: '' } },
    { ...valid, session: { ...valid.session, user: { ...f.user, email: 'foreign@example.test' } } },
  ]
  for (const data of invalid) {
    f.state.data = data; f.calls.length = 0
    await assert.rejects(f.schedule)
    assert.deepEqual(f.calls, ['password', 'cleanup'])
  }
  for (const data of [null, { session: null }, { session: { access_token: '' } }]) {
    f.state.data = data; f.calls.length = 0
    await assert.rejects(f.schedule)
    assert.deepEqual(f.calls, ['password'], 'no revocation request without a usable token')
  }
}))

test('foreign identities and invalid claims cannot schedule and still revoke their temporary proof', async () => fixture(async f => {
  const valid = f.state.data
  const foreign = { ...f.user, id: randomUUID() }
  f.state.data = { ...valid, user: foreign, session: { ...valid.session, user: foreign } }
  await assert.rejects(f.schedule, /Password identity mismatch/)
  assert.deepEqual(f.calls, ['password', 'cleanup'])
  f.state.data = valid
  const claims = f.state.claims
  for (const input of [{ claims: { ...claims, sub: randomUUID() } },
    { claims: { ...claims, session_id: 'invalid' } }, { claims, claimError: {} }]) {
    Object.assign(f.state, input); f.calls.length = 0
    await assert.rejects(f.schedule)
    assert.deepEqual(f.calls, ['password', 'claims', 'cleanup'])
  }
}))

test('a validated schedule relies on atomic database revocation; cleanup cannot turn success into failure', async () => fixture(async f => {
  f.state.cleanupThrows = true
  assert.deepEqual(await f.schedule(), f.scheduled)
  assert.deepEqual(f.calls, ['password', 'claims', 'schedule'])
  assert.deepEqual(f.diagnostics, [])
}))

test('cleanup failure preserves the actual excluded or expired RPC result and emits only a fixed diagnostic', async () => fixture(async f => {
  for (const status of ['operator-excluded', 'expired']) {
    for (const cleanupThrows of [false, true]) {
      f.state.result = { data: { status }, error: null }; f.state.cleanupThrows = cleanupThrows; f.calls.length = 0
      assert.deepEqual(await f.schedule(), { status })
      assert.deepEqual(f.calls, ['password', 'claims', 'schedule', 'cleanup'])
    }
  }
  assert.deepEqual(f.diagnostics, Array(2).fill(['Account deletion proof-session cleanup failed']))
  assert.doesNotMatch(JSON.stringify(f.diagnostics), new RegExp(f.token + '|private cleanup'))
}))

test('cleanup failure never masks a primary validation/transport/RPC error or invents success for an ambiguous response', async () => fixture(async f => {
  f.state.cleanupThrows = true
  const primary = new Error('primary transport failure')
  f.state.rpcThrows = primary
  await assert.rejects(f.schedule, error => error === primary)
  f.state.rpcThrows = null
  f.state.result = { data: f.scheduled, error: {} }
  await assert.rejects(f.schedule, /Deletion scheduling failed/)
  for (const data of [null, {}, { ...f.scheduled, unexpected: true }, { status: 'scheduled' }]) {
    f.state.result = { data, error: null }
    await assert.rejects(f.schedule, error => error.name === 'ZodError')
  }
  f.state.data = { ...f.state.data, user: null }
  await assert.rejects(f.schedule, error => error.name === 'ZodError')
  assert.equal(f.calls.filter(call => call === 'cleanup').length, 7)
  assert.equal(f.diagnostics.length, 7)
}))

test('provider credential, throttle and availability errors preserve their original outcomes without a proof', async () => fixture(async f => {
  f.state.data = { user: null, session: null }
  for (const code of ['invalid_credentials', 'user_banned']) {
    f.state.providerError = { code }
    assert.deepEqual(await f.schedule(), { status: 'password-invalid' })
  }
  f.state.providerError = { code: 'over_request_rate_limit' }
  await assert.rejects(f.schedule, error => error.status === 429)
  f.state.providerError = { code: 'unexpected_failure' }
  await assert.rejects(f.schedule, /Password verification unavailable/)
  assert.ok(f.calls.every(call => call === 'password'))
}))
