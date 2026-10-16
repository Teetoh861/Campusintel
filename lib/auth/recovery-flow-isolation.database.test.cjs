const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const { NextResponse } = require('next/server')

// Real grant RPCs on local Supabase only. No email delivery or provider calls.
const enabled = process.env.RECOVERY_FLOW_ISOLATION_DB_TEST === '1'
function db(sql) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_Campusintel', 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, 'Local grant fixture SQL failed')
  return result.stdout.trim()
}
async function fixture(run) {
  const status = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(status.status, 0, 'Local Supabase must already be running')
  const config = JSON.parse(status.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  const a = { userId: randomUUID(), email: 'a@example.test' }, b = { userId: randomUUID(), email: 'b@example.test' }
  const jar = new Map(), calls = [], original = Module._load, cache = new Map(Object.entries(require.cache))
  const oldSecret = process.env.AUTH_INTERNAL_SECRET
  let rejectCode = false
  const configMock = { isStudentAuthEnabled: () => true, getSupabaseConfig: () => ({ url: config.API_URL, key: config.ANON_KEY }),
    getAuthSecretKey: () => config.SERVICE_ROLE_KEY, isTrustedAuthOrigin: origin => origin === 'http://localhost:3000' }
  try {
    // Lifecycle-aware grants require a real Auth identity, even when this
    // fixture deliberately replaces provider verification/password methods.
    db(`insert into auth.users(id,email_confirmed_at) values ('${a.userId}',now()),('${b.userId}',now());`)
    process.env.AUTH_INTERNAL_SECRET = randomBytes(32).toString('hex')
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config' || (name === './config' && args[0]?.filename.includes('/lib/auth/'))) return configMock
      if (name === 'next/headers') return { cookies: async () => ({ get: key => jar.has(key) ? { value: jar.get(key) } : undefined,
        getAll: () => [...jar].map(([name, value]) => ({ name, value })) }) }
      if (name === '@/lib/auth/student-state') return { rejectExistingStudent: async () => null }
      if (name === '@/lib/auth/rate-limit') return { consumeAuthLimit: async (...values) => { calls.push(['limit', ...values]) } }
      if (name === '@/lib/supabase/auth-gateway') return { getAuthGateway: () => ({
        verifyOtp: async input => {
          calls.push(['verify', input.email]); assert.equal(input.type, 'recovery')
          if (rejectCode) return { data: { session: null, user: null }, error: { code: 'otp_expired' } }
          const account = input.email === a.email ? a : b
          assert.equal(input.email, account.email)
          const user = { id: account.userId, email: account.email, email_confirmed_at: '2026-10-11T00:00:00Z' }
          return { data: { user, session: { user, access_token: 'local-controlled-access', refresh_token: 'local-controlled-refresh' } }, error: null }
        },
        resetPasswordForEmail: async email => { calls.push(['initiate', email]); return { data: {}, error: null } },
      }) }
      if (name === '@/lib/supabase/recovery-auth') return { getRecoveryAuthGateway: () => ({
        revokeTemporarySession: async token => { assert.equal(token, 'local-controlled-access'); calls.push(['revoke', 'local']) },
        replacePasswordAndRevokeSessions: async (id, password) => { calls.push(['password', id]); assert.ok(password.length >= 8); return { error: null } },
      }) }
      return original.call(this, name, ...args)
    }
    for (const file of ['./recovery-grant.ts', './recovery-crypto.ts', './request.ts', './account-continuity.ts',
      '../../app/api/auth/verify-recovery/route.ts', '../../app/api/auth/reset-password/route.ts',
      '../../app/api/auth/cancel-recovery/route.ts', '../../app/api/auth/forgot-password/route.ts']) delete require.cache[require.resolve(file)]
    const grant = require('./recovery-grant.ts'), crypto = require('./recovery-crypto.ts')
    const use = response => { for (const cookie of response.cookies.getAll()) {
      if (cookie.value) jar.set(cookie.name, cookie.value); else jar.delete(cookie.name)
    } }
    const post = async (action, body) => {
      const response = await require(`../../app/api/auth/${action}/route.ts`).POST(new Request(`http://localhost:3000/api/auth/${action}`, {
        method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body),
      }))
      const result = await response.json()
      assert.doesNotMatch(JSON.stringify(result), /a@example|b@example|local-controlled|userId|grant_hash|flow_binding|access_token|refresh_token/)
      assert.equal(JSON.stringify(result).includes(a.userId) || JSON.stringify(result).includes(b.userId), false)
      return { response, body: result }
    }
    const verify = async account => {
      const result = await post('verify-recovery', { email: account.email, code: '123456' })
      assert.equal(result.response.status, 200); assert.deepEqual(result.body, { verified: true }); use(result.response)
      return result
    }
    const rows = () => db(`select coalesce(jsonb_agg(to_jsonb(g) order by user_id)::text,'[]')
      from public.auth_recovery_grants g where user_id in ('${a.userId}','${b.userId}');`)
    await run({ a, b, jar, calls, grant, crypto, post, use, verify, rows, rejectCode: value => { rejectCode = value } })
  } finally {
    Module._load = original
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    if (oldSecret === undefined) delete process.env.AUTH_INTERNAL_SECRET; else process.env.AUTH_INTERNAL_SECRET = oldSecret
    db(`delete from public.auth_recovery_grants where user_id in ('${a.userId}','${b.userId}');
      delete from auth.users where id in ('${a.userId}','${b.userId}');`)
  }
}

test('real grants: A page remains after B verification; stale A reset preserves B row/cookie and only B can replace password',
  { skip: !enabled }, async () => fixture(async f => {
    await f.verify(f.a); await f.verify(f.b)
    const before = f.rows(), cookie = f.jar.get('ci-recovery-grant')
    assert.equal(JSON.parse(before).length, 2)
    const stale = await f.post('reset-password', { email: f.a.email, password: 'A-new-password' })
    assert.equal(stale.response.status, 400); assert.equal(stale.body.code, 'RECOVERY_RESTART_REQUIRED')
    assert.equal(stale.response.headers.get('set-cookie'), null)
    f.use(stale.response)
    assert.equal(f.jar.get('ci-recovery-grant'), cookie); assert.equal(f.rows(), before)
    assert.equal(f.calls.some(call => call[0] === 'password'), false)
    const valid = await f.post('reset-password', { email: f.b.email, password: 'B-new-password' })
    assert.equal(valid.response.status, 200)
    assert.deepEqual(f.calls.filter(call => call[0] === 'password'), [['password', f.b.userId]])
    assert.equal(valid.response.cookies.get('ci-recovery-grant').maxAge, 0)
    assert.equal(JSON.parse(f.rows()).some(row => row.user_id === f.b.userId), false)
  }))

test('real grants: stale bound cancellation preserves B; matching B cancellation deletes and clears B',
  { skip: !enabled }, async () => fixture(async f => {
    await f.verify(f.b)
    const before = f.rows(), cookie = f.jar.get('ci-recovery-grant')
    const stale = await f.post('cancel-recovery', { email: f.a.email })
    assert.equal(stale.response.status, 200); assert.deepEqual(stale.body, { success: true })
    assert.equal(stale.response.headers.get('set-cookie'), null)
    f.use(stale.response); assert.equal(f.jar.get('ci-recovery-grant'), cookie); assert.equal(f.rows(), before)
    const valid = await f.post('cancel-recovery', { email: f.b.email })
    assert.deepEqual(valid.body, stale.body)
    assert.equal(valid.response.cookies.get('ci-recovery-grant').maxAge, 0)
    assert.equal(f.rows(), '[]')
  }))

test('real grants: failed stale A verification and resend cannot delete or clear B, which still resets',
  { skip: !enabled }, async () => {
    for (const action of ['verify-recovery', 'forgot-password']) await fixture(async f => {
      await f.verify(f.b)
      const before = f.rows(), cookie = f.jar.get('ci-recovery-grant')
      f.rejectCode(true)
      const stale = await f.post(action, { email: f.a.email, ...(action === 'verify-recovery' ? { code: '123456' } : {}) })
      assert.equal(stale.response.status, action === 'verify-recovery' ? 400 : 200)
      assert.equal(stale.response.headers.get('set-cookie'), null)
      f.use(stale.response); assert.equal(f.jar.get('ci-recovery-grant'), cookie); assert.equal(f.rows(), before)
      assert.equal(f.calls.some(call => call[0] === 'password'), false)
      const valid = await f.post('reset-password', { email: f.b.email, password: 'B-new-password' })
      assert.equal(valid.response.status, 200)
      assert.deepEqual(f.calls.filter(call => call[0] === 'password'), [['password', f.b.userId]])
    })
  })

test('real concurrent correct reset consumers have one password winner; mismatch racing match never claims B',
  { skip: !enabled }, async () => fixture(async f => {
    await f.verify(f.b)
    const results = await Promise.all([f.post('reset-password', { email: f.b.email, password: 'B-new-password' }),
      f.post('reset-password', { email: f.b.email, password: 'B-other-password' })])
    assert.deepEqual(results.map(result => result.response.status).sort(), [200, 400])
    assert.deepEqual(f.calls.filter(call => call[0] === 'password'), [['password', f.b.userId]])
    assert.equal(f.rows(), '[]')
    f.calls.length = 0
    await f.verify(f.b)
    const race = await Promise.all([f.post('reset-password', { email: f.a.email, password: 'A-new-password' }),
      f.post('reset-password', { email: f.b.email, password: 'B-new-password' })])
    assert.deepEqual(race.map(result => result.response.status), [400, 200])
    assert.equal(race[0].response.headers.get('set-cookie'), null)
    assert.deepEqual(f.calls.filter(call => call[0] === 'password'), [['password', f.b.userId]])
    assert.equal(f.rows(), '[]')
  }))

test('real matching claim stays one-time; expired/unknown/tampered credentials never authorize or blindly clear; global discard remains explicit',
  { skip: !enabled }, async () => fixture(async f => {
    await f.verify(f.b)
    const original = f.jar.get('ci-recovery-grant'), hash = f.crypto.recoveryDigest(original, 'credential')
    // Deterministic expiry, preserving the existing ten-minute check constraint.
    db(`update public.auth_recovery_grants set created_at=now()-interval '11 minutes',
      expires_at=now()-interval '1 minute' where grant_hash='${hash}';`)
    for (const credential of [original, original, 'tampered', 'A'.repeat(43), undefined]) {
      if (credential === undefined) f.jar.delete('ci-recovery-grant'); else f.jar.set('ci-recovery-grant', credential)
      const result = await f.post('reset-password', { email: f.b.email, password: 'B-new-password' })
      assert.equal(result.response.status, 400); assert.equal(result.response.headers.get('set-cookie'), null)
    }
    assert.equal(f.calls.some(call => call[0] === 'password'), false)
    await f.verify(f.b)
    await f.grant.discardCurrentRecoveryGrant()
    assert.equal(f.rows(), '[]')
    const response = new NextResponse(); f.grant.clearRecoveryCookie(response)
    assert.equal(response.cookies.get('ci-recovery-grant').maxAge, 0)
  }))
