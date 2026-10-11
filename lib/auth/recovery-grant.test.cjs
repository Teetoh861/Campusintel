// lib/auth/recovery-grant.test.cjs — Actual grant/route code with isolated provider and atomic-store doubles.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextResponse } = require('next/server')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const original = Module._load
  const oldEnv = { ...process.env }
  const files = ['recovery-grant.ts', '../../app/api/auth/verify-recovery/route.ts', '../../app/api/auth/reset-password/route.ts', '../../app/api/auth/cancel-recovery/route.ts', '../../app/api/auth/logout/route.ts', '../supabase/recovery-auth.ts', '../../app/api/auth/forgot-password/route.ts']
    .map(file => require.resolve(file.startsWith('../') ? file : './' + file))
  const rows = new Map(), jar = new Map(), calls = []
  const userId = randomUUID(), email = 'recovery@example.test'
  let providerError = null, revocationError = null, currentIdentity = null, storeError = false
  const identity = { userId, email, accessToken: 'fixture-access-only', refreshToken: 'fixture-refresh-only' }
  const mocks = {
    'next/headers': { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
      getAll: () => [...jar].map(([name, value]) => ({ name, value })) }) },
    '@/lib/auth/student-state': { rejectExistingStudent: async () => null },
    '@/lib/auth/rate-limit': { consumeAuthLimit: async (...args) => { calls.push(['limit', ...args]) } },
    '@/lib/supabase/auth-gateway': { getAuthGateway: () => ({ verifyOtp: async body => {
      calls.push(['verify']); assert.equal(body.type, 'recovery')
      if (providerError) return { data: { session: null, user: null }, error: providerError }
      const user = { id: currentIdentity?.userId ?? userId, email: currentIdentity?.email ?? email, email_confirmed_at: '2026-09-16T00:00:00Z' }
      return { data: { session: { access_token: identity.accessToken, refresh_token: identity.refreshToken, user }, user }, error: null }
    }, resetPasswordForEmail: async email => { calls.push(['initiate', email]); return { data: {}, error: null } } }) },
    '@supabase/supabase-js': { createClient: (url, key, options) => {
      assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })
      return { auth: { admin: {
        signOut: async (jwt, scope) => { assert.equal(jwt, identity.accessToken); calls.push(['temporary-revoke', scope]); return { error: revocationError } },
        updateUserById: async (id, attributes) => { assert.ok([...rows.values()].every(row => row.userId !== id), 'grant consumed before password operation'); assert.deepEqual(Object.keys(attributes), ['password']); calls.push(['update', id]); return { data: { user: { id } }, error: null } },
      } }, rpc: async (name, args) => {
        if (name === 'issue_recovery_grant') {
          for (const [hash, row] of rows) if (row.userId === args.p_user_id) rows.delete(hash)
          rows.set(args.p_hash, { userId: args.p_user_id, binding: args.p_binding, createdAt: Date.now(), expiresAt: Date.now() + 600000 }); return { data: null, error: null }
        }
        assert.equal(name, 'consume_recovery_grant')
        if (storeError) return { data: null, error: { message: 'private RPC failure' } }
        const row = rows.get(args.p_hash)
        const matches = row && (args.p_binding === null || args.p_binding === row.binding)
        if (matches) rows.delete(args.p_hash)
        return { data: matches && args.p_binding !== null && row.expiresAt > Date.now() ? row.userId : null, error: null }
      } }
    } },
    '@/lib/supabase/server': { createClient: async response => ({ auth: {
      getClaims: async () => ({ data: null, error: null }),
      setSession: async () => { throw new Error('Recovery must never establish a student session') },
      updateUser: async () => { throw new Error('Recovery must use the verified privileged operation') },
      signOut: async ({ scope }) => { calls.push(['signout', scope]); response.cookies.set('sb-fixture-auth-token', '', { maxAge: 0 }); return { error: null } },
    } }) },
    '@/lib/auth/mutation-context': { getAuthenticatedMutationContext: async response => ({
      status: 'ready', context: { client: await mocks['@/lib/supabase/server'].createClient(response),
        user: { id: userId }, sessionId: 'fixture-current-session' },
    }) },
  }
  try {
    Object.assign(process.env, { NODE_ENV: 'production', STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public', SUPABASE_SECRET_KEY: 'sb_secret_fixture',
      AUTH_INTERNAL_SECRET: 'test-only-recovery-material-not-a-real-secret' })
    Module._load = function(name, ...args) { return mocks[name] || original.call(this, name, ...args) }
    for (const file of files) delete require.cache[file]
    const grant = require(files[0])
    const post = async (index, body, origin = 'http://localhost:3000') => {
      const response = await require(files[index]).POST(new Request('http://localhost:3000/api/auth/test', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      const result = await response.json()
      assert.doesNotMatch(JSON.stringify(result), /fixture-access|fixture-refresh|fixture-staged|recovery@example|userId|access_token|refresh_token/)
      return { response, body: result }
    }
    await run({ post, grant, rows, jar, calls, identity, email, providerIdentity: value => { currentIdentity = value }, storeError: value => { storeError = value }, error: value => { providerError = value }, revokeError: value => { revocationError = value },
      use: response => { for (const c of response.cookies.getAll()) if (c.value) jar.set(c.name,c.value); else jar.delete(c.name) } })
  } finally {
    Module._load = original
    for (const file of files) delete require.cache[file]
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
  }
}

test('malformed and cross-origin verification stop before provider; wrong/expired/consumed codes issue no grant', async () => fixture(async f => {
  for (const code of ['', 'not-numeric']) assert.equal((await f.post(1, { email: f.email, code })).response.status, 400)
  assert.equal((await f.post(1, { email: f.email, code: '123456' }, 'https://evil.test')).response.status, 403)
  assert.equal(f.calls.length, 0)
  for (const message of ['wrong', 'expired', 'already used']) {
    f.error({ code: 'otp_expired', message })
    const { response, body } = await f.post(1, { email: f.email, code: '123456' })
    assert.equal(response.status, 400)
    assert.deepEqual(body, { error: 'Invalid or expired code.' })
    assert.equal(f.rows.size, 0)
    assert.ok(response.cookies.getAll().every(cookie => cookie.value === ''))
  }
  assert.equal(f.calls.filter(c => c[0] === 'verify').length, 3)
  assert.ok(f.calls.filter(c => c[0] === 'limit').every(c => c[1] === 'PASSWORD_RESET_SUBMIT'))
}))

test('verified grant is opaque/HttpOnly and password change consumes it once with global signout', async () => fixture(async f => {
  assert.equal((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 400)
  const verified = await f.post(1, { email: f.email, code: '123456' })
  assert.deepEqual(verified.body, { verified: true })
  const cookies = verified.response.cookies.getAll()
  assert.equal(cookies.length, 1)
  const cookie = cookies[0]
  assert.equal(cookie.name, 'ci-recovery-grant')
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'lax')
  assert.equal(cookie.path, '/api/auth'); assert.equal(cookie.maxAge, 600)
  assert.ok(!JSON.stringify([...f.rows]).includes(cookie.value))
  assert.deepEqual(Object.keys([...f.rows.values()][0]), ['userId','binding','createdAt','expiresAt'])
  assert.doesNotMatch(JSON.stringify([...f.rows]), /fixture-access|fixture-refresh|recovery@example/)
  f.use(verified.response)
  const changed = await f.post(2, { email: f.email, password: 'new-password' })
  assert.equal(changed.response.status, 200)
  assert.equal(f.rows.size, 0)
  assert.equal(changed.response.cookies.get('ci-recovery-grant').value, '')
  assert.equal(changed.response.cookies.get('ci-recovery-grant').maxAge, 0)
  assert.match(changed.response.cookies.get('ci-student-session-generation').value, /^[a-f0-9]{32}$/)
  assert.equal(changed.response.cookies.getAll().some(c => c.name.startsWith('ci-student-auth-') && c.value), false)
  assert.deepEqual(f.calls.filter(c => c[0] === 'temporary-revoke'), [['temporary-revoke','local']])
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'update'), [['update', f.identity.userId]])
  assert.ok(f.calls.findIndex(c => c[0] === 'temporary-revoke') < f.calls.findIndex(c => c[0] === 'update'))
  f.jar.set(cookie.name, cookie.value) // Replay the original credential after successful consumption.
  assert.equal((await f.post(2, { email: f.email, password: 'another-password' })).response.status, 400)
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 1)
}))

test('wrong-account, expired, tampered and cancelled grants cannot change passwords', async () => fixture(async f => {
  const mint = async () => { const r = await f.post(1, { email: f.email, code: '123456' }); f.use(r.response) }
  await mint()
  assert.equal((await f.post(2, { email: 'other@example.test', password: 'new-password' })).response.status, 400)
  await mint()
  f.jar.set('ci-recovery-grant', 'tampered')
  assert.equal((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 400)
  await mint()
  f.jar.set('ci-recovery-grant', 'A'.repeat(43))
  assert.notEqual((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 200)
  await mint()
  const now = Date.now
  try { Date.now = () => now() + 601000; assert.notEqual((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 200) }
  finally { Date.now = now }
  await mint()
  const cancelled = await f.post(3, { email: f.email })
  assert.equal(cancelled.response.status, 200)
  assert.equal(cancelled.response.cookies.get('ci-recovery-grant').value, '')
  assert.equal((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 400)
  assert.equal(f.calls.some(c => c[0] === 'update'), false)
}))

test('grant indexes are purpose separated; replacement and reset invalidate older grants', async () => fixture(async f => {
  const { makeRecoveryGrant, recoveryDigest } = require('./recovery-crypto.ts')
  assert.throws(() => makeRecoveryGrant(f.identity)) // Extra provider-token fields are rejected, not persisted.
  assert.notEqual(recoveryDigest('same', 'credential'), recoveryDigest('same', 'flow'))
  const identity = { userId: f.identity.userId, email: f.email }
  const first = new NextResponse(), second = new NextResponse()
  await f.grant.issueRecoveryGrant(identity, first)
  await f.grant.issueRecoveryGrant(identity, second)
  f.use(first)
  assert.equal(await f.grant.consumeRecoveryGrant(f.email), null)
  f.use(second)
  const changed = await f.post(2, { email: f.email, password: 'new-password' })
  assert.equal(changed.response.status, 200)
  f.use(first)
  assert.equal((await f.post(2, { email: f.email, password: 'another-password' })).response.status, 400)
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 1)
  await f.grant.issueRecoveryGrant(identity, second)
  f.use(second)
  const results = await Promise.all([f.grant.consumeRecoveryGrant(f.email), f.grant.consumeRecoveryGrant(f.email)])
  assert.equal(results.filter(Boolean).length, 1)
}))

test('failed temporary-session revocation cannot issue a recovery grant', async () => fixture(async f => {
  f.revokeError({ message: 'private provider error' })
  const result = await f.post(1, { email: f.email, code: '123456' })
  assert.equal(result.response.status, 503)
  assert.equal(result.body.error, 'Something went wrong. Please try again.')
  assert.equal(f.rows.size, 0)
  assert.ok(result.response.cookies.getAll().every(cookie => cookie.value === ''))
  assert.deepEqual(f.calls.filter(c => c[0] === 'temporary-revoke'), [['temporary-revoke','local']])
}))

test('logout invalidates recovery authorization as well as the current student session', async () => fixture(async f => {
  const verified = await f.post(1, { email: f.email, code: '123456' })
  f.use(verified.response)
  const loggedOut = await f.post(4, {})
  assert.equal(loggedOut.response.status, 200)
  assert.match(loggedOut.response.headers.getSetCookie().find(cookie => cookie.startsWith('ci-recovery-grant=')),
    /^ci-recovery-grant=;.*Max-Age=0/)
  assert.equal(f.rows.size, 0)
  assert.deepEqual(f.calls.filter(c => c[0] === 'signout'), [['signout', 'local']])
  assert.equal((await f.post(2, { email: f.email, password: 'new-password' })).response.status, 400)
}))

test('stale A reset with B cookie cannot delete B, clear its cookie, or replace either password', async () => fixture(async f => {
  const a = { userId: randomUUID(), email: 'a@example.test' }
  const b = { userId: randomUUID(), email: 'b@example.test' }
  for (const account of [a, b]) {
    f.providerIdentity(account)
    const verified = await f.post(1, { email: account.email, code: '123456' })
    assert.equal(verified.response.status, 200)
    f.use(verified.response)
  }
  const before = [...f.rows], currentCookie = f.jar.get('ci-recovery-grant')
  const stale = await f.post(2, { email: a.email, password: 'A-new-password' })
  assert.equal(stale.response.status, 400)
  assert.equal(stale.body.code, 'RECOVERY_RESTART_REQUIRED')
  assert.deepEqual([...f.rows], before)
  assert.equal(stale.response.cookies.getAll().length, 0)
  f.use(stale.response)
  assert.equal(f.jar.get('ci-recovery-grant'), currentCookie)
  assert.equal(f.calls.some(call => call[0] === 'update'), false)
  const valid = await f.post(2, { email: b.email, password: 'B-new-password' })
  assert.equal(valid.response.status, 200)
  assert.deepEqual(f.calls.filter(call => call[0] === 'update'), [['update', b.userId]])
  assert.equal(valid.response.cookies.get('ci-recovery-grant').maxAge, 0)
  assert.ok([...f.rows.values()].every(row => row.userId !== b.userId))
}))

test('stale bound cancel, failed verification and resend preserve the newer B grant and cookie', async () => {
  for (const action of ['cancel', 'verify', 'resend']) await fixture(async f => {
    const b = { userId: randomUUID(), email: 'b@example.test' }
    const issued = new NextResponse()
    await f.grant.issueRecoveryGrant(b, issued); f.use(issued)
    const before = [...f.rows], cookie = f.jar.get('ci-recovery-grant')
    if (action === 'verify') f.error({ code: 'otp_expired' })
    const stale = action === 'cancel' ? await f.post(3, { email: 'a@example.test' })
      : action === 'verify' ? await f.post(1, { email: 'a@example.test', code: '123456' })
        : await f.post(6, { email: 'a@example.test' })
    assert.equal(stale.response.status, action === 'verify' ? 400 : 200)
    assert.equal(stale.response.cookies.getAll().length, 0)
    assert.deepEqual([...f.rows], before)
    f.use(stale.response); assert.equal(f.jar.get('ci-recovery-grant'), cookie)
    assert.equal(f.calls.some(call => call[0] === 'update'), false)
    const recovered = await f.post(2, { email: b.email, password: 'B-new-password' })
    assert.equal(recovered.response.status, 200)
    assert.deepEqual(f.calls.filter(call => call[0] === 'update'), [['update', b.userId]])
  })
})

test('matching re-verification cleanup clears only its own consumed flow on provider failure', async () => fixture(async f => {
  const issued = new NextResponse()
  await f.grant.issueRecoveryGrant({ userId: f.identity.userId, email: f.email }, issued); f.use(issued)
  f.error({ code: 'otp_expired' })
  const result = await f.post(1, { email: f.email, code: '123456' })
  assert.equal(result.response.status, 400)
  assert.equal(f.rows.size, 0)
  assert.equal(result.response.cookies.get('ci-recovery-grant').maxAge, 0)
}))

test('bound cancellation strictly canonicalizes email and rejects identity, credential and flow inputs', async () => fixture(async f => {
  for (const body of [{}, { email: 'bad' }, { email: null },
    ...['userId', 'user_id', 'role', 'flow_binding', 'credential', 'extra'].map(key => ({ email: f.email, [key]: 'x' }))]) {
    assert.equal((await f.post(3, body)).response.status, 400)
  }
  assert.equal((await f.post(3, { email: f.email }, 'https://evil.test')).response.status, 403)
  const issued = new NextResponse()
  await f.grant.issueRecoveryGrant({ userId: f.identity.userId, email: f.email }, issued); f.use(issued)
  const cancelled = await f.post(3, { email: `  ${f.email.toUpperCase()}  ` })
  assert.deepEqual(cancelled.body, { success: true })
  assert.equal(f.rows.size, 0)
  assert.equal(cancelled.response.cookies.get('ci-recovery-grant').maxAge, 0)
}))

test('ambiguous store failure cannot prove ownership or clear the current recovery cookie', async () => fixture(async f => {
  const issued = new NextResponse()
  await f.grant.issueRecoveryGrant({ userId: f.identity.userId, email: f.email }, issued); f.use(issued)
  f.storeError(true)
  for (const [route, body] of [[1, { email: f.email, code: '123456' }],
    [2, { email: f.email, password: 'new-password' }], [3, { email: f.email }]]) {
    const result = await f.post(route, body)
    assert.equal(result.response.status, 503)
    assert.equal(result.response.cookies.getAll().length, 0)
    assert.equal(f.rows.size, 1)
  }
  assert.equal(f.calls.some(call => call[0] === 'update'), false)
}))
