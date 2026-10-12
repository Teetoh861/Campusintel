const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')
const Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')
const { createServerClient } = require('@supabase/ssr')
const { NextRequest, NextResponse } = require('next/server')
const { applyResponseCookies, createRenderRequestStore } = require('./session-generation-fixture.cjs')

// Shared local-only Auth/SDK fixture; production namespace and route logic stay real.
async function fixture(run) {
  const status = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(status.status, 0, 'Local Supabase must be running')
  const config = JSON.parse(status.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const context = new AsyncLocalStorage(), jar = new Map(), accounts = [], calls = [], clients = []
  const password = 'local-fixture-' + randomUUID()
  const proxyState = { refresh: false, rotated: false, refreshCalls: 0 }
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
      if (name === 'next/headers') return { headers: async () => context.getStore().renderStore?.headers ?? new Headers(
        context.getStore().rawCookieHeader === null ? {} : { cookie: context.getStore().rawCookieHeader }), cookies: async () => {
        if (context.getStore().renderStore) return context.getStore().renderStore.cookies
        const requestJar = context.getStore()?.jar
        assert.ok(requestJar, 'a real request-local cookie snapshot is required')
        return { getAll: () => [...requestJar].map(([name, value]) => ({ name, value })),
          get: key => requestJar.has(key) ? { value: requestJar.get(key) } : undefined,
          set: (key, value) => { requestJar.set(key, value) } }
      } }
      if (name === '@supabase/ssr') return { createServerClient: (url, key, options) => {
        clients.push(options)
        const client = createServerClient(url, key, options)
        if (args[0]?.filename.endsWith('/lib/supabase/proxy.ts')) {
          const claims = client.auth.getClaims.bind(client.auth)
          client.auth.getClaims = async () => {
            // Deterministically force the normal SDK refresh path; no sleeps,
            // token decoding, cookie encoding, or production hook is needed.
            if (proxyState.refresh) {
              const before = await client.auth.getSession()
              if (before.data.session) {
                proxyState.refreshCalls++
                const refreshed = await client.auth.refreshSession()
                assert.equal(refreshed.error, null, 'real local proxy refresh succeeded')
                proxyState.rotated = before.data.session.refresh_token !== refreshed.data.session.refresh_token
              }
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
    const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    const pageRequest = (rawCookieHeader = cookieHeader()) => new NextRequest('http://localhost:3000/dashboard', {
      headers: rawCookieHeader === null ? {} : { cookie: rawCookieHeader },
    })
    const invoke = (fn, rawCookieHeader = cookieHeader()) => context.run({ rawCookieHeader,
      jar: new Map(pageRequest(rawCookieHeader).cookies.getAll().map(cookie => [cookie.name, cookie.value])) }, fn)
    const cookiesOf = response => new NextResponse(null, { headers: response.headers }).cookies.getAll()
    const apply = response => applyResponseCookies(jar, response)
    const selected = () => jar.get(generation.STUDENT_SESSION_GENERATION_COOKIE)
    const current = (rawCookieHeader = cookieHeader()) => invoke(() => student.getStudentSessionContext(NextResponse.json({})), rawCookieHeader)
    const pageToken = async () => { const live = await current(); return issueAccountContinuityToken(live.user.id, live.sessionId) }
    const post = (action, body, token, rawCookieHeader = cookieHeader()) => invoke(() => require(`../../app/api/auth/${action}/route.ts`).POST(new Request(
      `http://localhost:3000/api/auth/${action}`, { method: 'POST', headers: { origin: 'http://localhost:3000',
          'content-type': 'application/json', ...(token ? { 'x-campus-account-continuity': token } : {}) }, body: JSON.stringify(body) })), rawCookieHeader)
    const login = async (account, rawCookieHeader = cookieHeader()) => {
      const response = await post('login', { email: account.email, password }, undefined, rawCookieHeader)
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { next: '/dashboard' })
      apply(response); return response
    }
    const native = async (hasSession = true, rawCookieHeader = cookieHeader()) => {
      proxyState.refresh = true; proxyState.rotated = false; proxyState.refreshCalls = 0
      const response = await proxy.refreshStudentSession(pageRequest(rawCookieHeader))
      proxyState.refresh = false
      assert.equal(proxyState.rotated, hasSession, hasSession ? 'actual local Auth refresh token rotated' : 'no isolated-session refresh')
      if (!hasSession) assert.equal(proxyState.refreshCalls, 0, 'malformed selectors never refresh legacy credentials')
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
    const completeProfile = async firstName => {
      const route = require('../../app/api/profile-selection/route.ts'), initial = await invoke(route.GET)
      const state = await initial.json(), token = await pageToken()
      assert.equal(state.status, 'incomplete')
      const response = await invoke(() => route.PUT(new Request('http://localhost:3000/api/profile-selection', {
        method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
          'x-campus-account-continuity': token }, body: JSON.stringify({ first_name: firstName, expectedRevision: state.revision,
          departmentId: state.options.departments[0].id, academicLevelId: state.options.academicLevels[0].id,
          academicPeriodId: state.options.academicPeriods[0].id }),
      })))
      assert.equal(response.status, 200); assert.equal((await response.json()).status, 'complete'); apply(response)
    }
    await run({ accounts, jar, calls, clients, generation, server, student, invoke, cookiesOf, apply, selected, current, pageToken,
      render: (response, fn) => { const renderStore = createRenderRequestStore(response)
        return context.run({ renderStore }, () => fn(renderStore)) },
      post, login, native, legacy, completeProfile, password, cookieHeader, pageRequest,
      confirmation: async (account, rawCookieHeader = cookieHeader()) => {
        const result = await gateway.getAuthGateway('local').signInWithPassword({ email: account.email, password })
        assert.equal(result.error, null); confirmationSession = result.data.session
        return post('confirm-email', { email: account.email, code: '123456' }, undefined, rawCookieHeader)
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

module.exports = { fixture }
