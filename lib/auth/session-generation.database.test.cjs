const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')
const Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')
const { createServerClient } = require('@supabase/ssr')
const { NextRequest, NextResponse } = require('next/server')
const { applyResponseCookies } = require('./session-generation-fixture.cjs')

// Explicit opt-in; real local Auth, SDK cookie storage, route clients and owner RLS.
const enabled = process.env.SESSION_GENERATION_DB_TEST === '1'
async function fixture(run) {
  const status = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(status.status, 0, 'Local Supabase must be running')
  const config = JSON.parse(status.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const context = new AsyncLocalStorage(), jar = new Map(), accounts = [], calls = []
  const password = 'local-fixture-' + randomUUID()
  const proxyState = { refresh: false, rotated: false }
  let confirmationSession
  try {
    Object.assign(process.env, { NODE_ENV: 'production', STUDENT_AUTH_ENABLED: 'true', VERCEL: '0',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY, SUPABASE_SECRET_KEY: config.SERVICE_ROLE_KEY })
    const gateway = require('../supabase/auth-gateway.ts')
    for (const actor of ['A', 'B']) {
      const email = randomUUID() + '@example.test'
      const made = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      assert.equal(made.error, null, 'local fixture user created')
      accounts.push({ actor, email, id: made.data.user.id })
    }
    Module._load = function (name, ...args) {
      if (name === 'next/headers') return { cookies: async () => {
        const requestJar = context.getStore()
        assert.ok(requestJar, 'a real request-local cookie snapshot is required')
        return { getAll: () => [...requestJar].map(([name, value]) => ({ name, value })),
          get: key => requestJar.has(key) ? { value: requestJar.get(key) } : undefined,
          set: (key, value) => { requestJar.set(key, value) } }
      } }
      if (name === '@supabase/ssr') return { createServerClient: (url, key, options) => {
        const client = createServerClient(url, key, options)
        if (args[0]?.filename.endsWith('/lib/supabase/proxy.ts')) {
          const claims = client.auth.getClaims.bind(client.auth)
          client.auth.getClaims = async () => {
            // Deterministically force the normal SDK refresh path; no sleeps,
            // token decoding, cookie encoding, or production hook is needed.
            if (proxyState.refresh) {
              const before = await client.auth.getSession(), refreshed = await client.auth.refreshSession()
              assert.equal(refreshed.error, null, 'real local proxy refresh succeeded')
              proxyState.rotated = before.data.session.refresh_token !== refreshed.data.session.refresh_token
            }
            return claims()
          }
        }
        return client
      } }
      if (name === '@/lib/auth/rate-limit') return { consumeAuthLimit: async () => {} }
      if (name === '@/lib/analytics/server') return { recordSuccessfulLogin: async () => {}, recordConfirmedSignup: async () => {} }
      if (name === '@/lib/supabase/auth-gateway') return { getAuthGateway: address => ({ ...gateway.getAuthGateway(address),
        verifyOtp: async input => {
          assert.equal(input.type, 'signup'); assert.equal(input.email, confirmationSession.user.email)
          return { data: { user: confirmationSession.user, session: confirmationSession }, error: null }
        },
      }) }
      return load.call(this, name, ...args)
    }
    for (const file of ['./session-generation.ts', '../supabase/server.ts', '../supabase/proxy.ts', './student-state.ts',
      './account-continuity.ts', './mutation-context.ts', './request.ts', './response.ts',
      '../../app/api/auth/login/route.ts', '../../app/api/auth/confirm-email/route.ts', '../../app/api/auth/logout/route.ts',
      '../../app/api/auth/session/route.ts', '../../app/api/profile-selection/route.ts', '../profile/student-profile.ts']) {
      delete require.cache[require.resolve(file)]
    }
    const generation = require('./session-generation.ts'), student = require('./student-state.ts')
    const server = require('../supabase/server.ts'), proxy = require('../supabase/proxy.ts')
    const { issueAccountContinuityToken } = require('./account-continuity.ts')
    const invoke = fn => context.run(new Map(jar), fn)
    const cookiesOf = response => new NextResponse(null, { headers: response.headers }).cookies.getAll()
    const apply = response => applyResponseCookies(jar, response)
    const selected = () => jar.get(generation.STUDENT_SESSION_GENERATION_COOKIE)
    const current = () => invoke(() => student.getStudentSessionContext(NextResponse.json({})))
    const pageToken = async () => { const live = await current(); return issueAccountContinuityToken(live.user.id, live.sessionId) }
    const post = (action, body, token) => invoke(() => require(`../../app/api/auth/${action}/route.ts`).POST(new Request(
      `http://localhost:3000/api/auth/${action}`, { method: 'POST', headers: { origin: 'http://localhost:3000',
        'content-type': 'application/json', ...(token ? { 'x-campus-account-continuity': token } : {}) }, body: JSON.stringify(body) })))
    const login = async account => {
      const response = await post('login', { email: account.email, password })
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { next: '/dashboard' })
      apply(response); return response
    }
    const native = async () => {
      proxyState.refresh = true
      const response = await proxy.refreshStudentSession(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      }))
      proxyState.refresh = false
      assert.equal(proxyState.rotated, true, 'actual local Auth refresh token rotated')
      assert.equal(cookiesOf(response).some(cookie => cookie.name === generation.STUDENT_SESSION_GENERATION_COOKIE), false)
      return response
    }
    const legacy = async account => {
      const authenticated = await gateway.getAuthGateway('local').signInWithPassword({ email: account.email, password })
      assert.equal(authenticated.error, null)
      const response = NextResponse.json({})
      const client = createServerClient(config.API_URL, config.ANON_KEY, { cookies: {
        getAll: () => [], setAll: items => items.forEach(cookie => response.cookies.set(cookie.name, cookie.value, cookie.options)),
      } })
      assert.equal((await client.auth.setSession(authenticated.data.session)).error, null)
      jar.clear(); apply(response)
      assert.equal(selected(), undefined)
    }
    await run({ accounts, jar, calls, generation, server, invoke, cookiesOf, apply, selected, current, pageToken,
      post, login, native, legacy, password, confirmation: async account => {
        const result = await gateway.getAuthGateway('local').signInWithPassword({ email: account.email, password })
        assert.equal(result.error, null); confirmationSession = result.data.session
        return post('confirm-email', { email: account.email, code: '123456' })
      } })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
    for (const account of accounts) assert.equal((await admin.auth.admin.deleteUser(account.id)).error, null)
  }
}

test('real native A refresh is inert after logout tombstone and login B; stale A mutation/logout cannot affect B',
  { skip: !enabled }, async () => fixture(async f => {
    const [a, b] = f.accounts
    await f.login(a)
    const ga = f.selected(), tokenA = await f.pageToken(), held = await f.native()
    const nameA = f.generation.resolveStudentSessionNamespace(ga).storageName
    assert.ok(f.cookiesOf(held).length > 0)
    assert.ok(f.cookiesOf(held).every(cookie => cookie.name === nameA || cookie.name.startsWith(nameA + '.')))
    const oldCookieNames = [...f.jar.keys()].filter(name => name === nameA || name.startsWith(nameA + '.'))
    assert.ok(oldCookieNames.length > 0, 'the browser contains A Auth cookies before logout')
    const logout = await f.post('logout', {}, tokenA)
    assert.equal(logout.status, 200); f.apply(logout)
    for (const name of oldCookieNames) {
      assert.ok(logout.headers.getSetCookie().some(header => header.startsWith(name + '=') && /; Max-Age=0(?:;|$)/.test(header)))
      assert.equal(f.jar.has(name), false, 'production logout removes each Auth-cookie key from the browser jar')
    }
    const blank = f.selected(); assert.notEqual(blank, ga)
    f.apply(held); assert.equal(f.selected(), blank); assert.equal(await f.current(), null)
    for (const cookie of f.cookiesOf(held)) assert.equal(f.jar.get(cookie.name), cookie.value, 'late A Auth cookies physically reappear')
    const repeated = await f.post('logout', {})
    assert.equal(repeated.status, 200); f.apply(repeated)
    const repeatedBlank = f.selected(); assert.notEqual(repeatedBlank, blank)
    f.apply(held); assert.equal(await f.current(), null, 'already-signed-out cleanup remains a tombstone')
    await f.login(b)
    const gb = f.selected(); assert.notEqual(gb, ga); assert.notEqual(gb, blank); assert.notEqual(gb, repeatedBlank)
    const selectedCookies = [...f.jar].filter(([name]) => name.startsWith(f.generation.resolveStudentSessionNamespace(gb).storageName))
    f.apply(held)
    assert.equal(f.selected(), gb)
    for (const [name, value] of selectedCookies) assert.ok(f.jar.get(name) === value, 'B cookie unchanged by late A response')
    assert.equal((await f.current()).user.id, b.id)
    const status = await f.invoke(() => require('../../app/api/auth/session/route.ts').GET(new Request('http://localhost:3000/api/auth/session')))
    assert.deepEqual(await status.json(), { enabled: true, signedIn: true })
    assert.equal(f.cookiesOf(status).some(cookie => cookie.name === f.generation.STUDENT_SESSION_GENERATION_COOKIE), false)
    const profile = require('../../app/api/profile-selection/route.ts')
    const before = await f.invoke(profile.GET), state = await before.json()
    assert.equal(state.status, 'incomplete'); assert.equal(state.revision, 0)
    const stale = await f.invoke(() => profile.PUT(new Request('http://localhost:3000/api/profile-selection', {
      method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-campus-account-continuity': tokenA },
      body: JSON.stringify({ first_name: 'Must not save', expectedRevision: 0, departmentId: state.options.departments[0].id,
        academicLevelId: state.options.academicLevels[0].id, academicPeriodId: state.options.academicPeriods[0].id }),
    })))
    assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { status: 'session-changed' }); f.apply(stale)
    const after = await f.invoke(profile.GET)
    assert.deepEqual(await after.json(), state, 'stale A whole form performs no B mutation')
    const refusedLogout = await f.post('logout', {}, tokenA)
    assert.equal(refusedLogout.status, 409)
    assert.equal(f.cookiesOf(refusedLogout).some(cookie => cookie.name === f.generation.STUDENT_SESSION_GENERATION_COOKIE), false)
    f.apply(refusedLogout); assert.equal(f.selected(), gb); assert.equal((await f.current()).user.id, b.id)
  }))

test('real legacy SDK session authenticates and refreshes; malformed/empty selectors cannot recover legacy or obsolete cookies',
  { skip: !enabled }, async () => fixture(async f => {
    const [a, b] = f.accounts
    await f.legacy(a)
    assert.equal((await f.current()).user.id, a.id)
    const held = await f.native()
    assert.ok(f.cookiesOf(held).every(cookie => cookie.name.startsWith('sb-')))
    const token = await f.pageToken(), logout = await f.post('logout', {}, token)
    assert.equal(logout.status, 200); f.apply(logout); f.apply(held)
    assert.equal(await f.current(), null, 'blank generation ignores late legacy cookies')
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '../malformed')
    assert.equal(await f.current(), null, 'malformed selector cannot read legacy')
    const response = await f.login(b), gb = f.selected()
    assert.match(gb, /^[a-f0-9]{32}$/)
    assert.ok(f.cookiesOf(response).some(cookie => cookie.name.startsWith(f.generation.resolveStudentSessionNamespace(gb).storageName)))
    assert.equal((await f.current()).user.id, b.id)
  }))

test('real confirmation transfer selects fresh generation and the same jar authenticates through response-bound and render clients',
  { skip: !enabled }, async () => fixture(async f => {
    const old = 'a'.repeat(32)
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, old)
    const response = await f.confirmation(f.accounts[1])
    assert.equal(response.status, 200); f.apply(response)
    assert.notEqual(f.selected(), old)
    assert.equal((await f.current()).user.id, f.accounts[1].id)
    const rendered = await f.invoke(async () => (await f.server.createClient()).auth.getUser())
    assert.equal(rendered.error, null); assert.equal(rendered.data.user.id, f.accounts[1].id)
  }))
