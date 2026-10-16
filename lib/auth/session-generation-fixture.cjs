const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextRequest, NextResponse } = require('next/server')
const { createRequestStoreForRender } = require('next/dist/server/async-storage/request-store')

function createRenderRequestStore(response) {
  const headers = Object.fromEntries((response.headers.get('x-middleware-override-headers') ?? '').split(',')
    .filter(Boolean).map(name => [name, response.headers.get('x-middleware-request-' + name)]))
  const middlewareCookies = response.headers.get('x-middleware-set-cookie')
  if (middlewareCookies) headers['x-middleware-set-cookie'] = middlewareCookies
  // The real Next store merges middleware cookies by mutating these shared headers.
  return createRequestStoreForRender({ headers }, undefined, { pathname: '/dashboard', search: '' },
    {}, undefined, undefined, undefined, false)
}

function assertInvalidDownstream(f, response, rawCookieHeader) {
  const namespace = f.generation.resolveStudentSessionNamespaceFromCookieHeader(rawCookieHeader)
  assert.equal(namespace.mode, 'invalid')
  const forwarded = response.headers.get('x-middleware-request-cookie')
  assert.equal(forwarded, f.generation.canonicalizeStudentSessionCookieHeaderForDownstream(rawCookieHeader, namespace))
  const parsed = new NextRequest('http://localhost:3000/dashboard', { headers: { cookie: forwarded } }).cookies
  assert.equal(parsed.get(f.generation.STUDENT_SESSION_GENERATION_COOKIE).value, 'invalid')
  return forwarded
}

function applyResponseCookies(jar, response, now = Date.now()) {
  // Next's parsed response cookies can lose empty values and Max-Age=0.
  // Use the actual headers; an empty value alone is not a deletion.
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(';').map(part => part.trim())
    const equals = pair.indexOf('='), name = pair.slice(0, equals)
    const attributesByName = new Map(attributes.map(attribute => {
      const separator = attribute.indexOf('=')
      return separator < 0 ? [attribute.toLowerCase(), '']
        : [attribute.slice(0, separator).toLowerCase(), attribute.slice(separator + 1)]
    }))
    const maxAge = attributesByName.get('max-age')
    const seconds = /^-?\d+$/.test(maxAge ?? '') ? Number(maxAge) : undefined
    const expires = Date.parse(attributesByName.get('expires') ?? '')
    // A valid Max-Age takes precedence over Expires, as in a browser.
    if (seconds !== undefined ? seconds <= 0 : expires <= now) jar.delete(name)
    else jar.set(name, decodeURIComponent(pair.slice(equals + 1)))
  }
}

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const jar = new Map(), clients = [], calls = [], order = []
  const users = { A: { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.test', email_confirmed_at: '2026-01-01Z' },
    B: { id: '00000000-0000-4000-8000-000000000002', email: 'b@example.test', email_confirmed_at: '2026-01-01Z' } }
  const state = { transferError: false, signoutError: false, grant: true, resetError: false, rotateLookup: false, readOnlyCookies: false }
  let rawCookieHeader
  const cookieHeader = () => rawCookieHeader === undefined
    ? [...jar].map(([name, value]) => `${name}=${value}`).join('; ') : rawCookieHeader
  const pageRequest = () => new NextRequest('http://localhost:3000/dashboard', {
    headers: cookieHeader() === null ? {} : { cookie: cookieHeader() },
  })
  const verified = actor => ({ user: users[actor], session: { user: users[actor], access_token: `access-${actor}`, refresh_token: `refresh-${actor}` } })
  const sdk = (url, key, options) => {
    order.push('SDK client')
    const name = options.cookieOptions?.name ?? 'sb-fixture-auth-token'
    const actor = () => options.cookies.getAll().find(cookie => cookie.name === name)?.value.replace('rotated-', '')
    const write = value => options.cookies.setAll([{ name, value, options: { maxAge: value ? 100 : 0 } }], { 'X-Refresh-Test': 'preserved' })
    const client = { options, name, rpc: async name => { assert.equal(name, 'read_account_lifecycle'); return { data: { status: 'active', deletionAllowed: true }, error: null } }, auth: {
      getUser: async () => {
        const who = actor()
        if (who && state.rotateLookup) write(`rotated-${who}`)
        return { data: { user: users[who] ?? null }, error: who ? null : { name: 'AuthSessionMissingError' } }
      },
      getClaims: async () => {
        const who = actor()
        if (who) write(`rotated-${who}`)
        return { data: { claims: who ? { sub: users[who].id, session_id: `session-${who}` } : null }, error: null }
      },
      setSession: async input => {
        calls.push('transfer')
        const who = input.access_token.endsWith('A') ? 'A' : 'B'
        write(who)
        return { data: verified(who), error: state.transferError ? { message: 'transfer failed' } : null }
      },
      signOut: async ({ scope }) => {
        assert.equal(scope, 'local'); calls.push('signOut'); write('')
        return { error: state.signoutError ? { message: 'signout failed' } : null }
      },
    } }
    clients.push(client)
    return client
  }
  try {
    Object.assign(process.env, { NODE_ENV: 'production', STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })
    const config = { isStudentAuthEnabled: () => true, getAuthOrigin: () => 'http://localhost:3000',
      getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'unit-publishable' }),
      getAuthSecretKey: () => 'unit-only-generation-continuity-material', isTrustedAuthOrigin: origin => origin === 'http://localhost:3000' }
    Module._load = function (name, ...args) {
      if (name === 'next/headers') return {
        headers: async () => {
          order.push('raw headers')
          return state.renderStore?.headers ?? new Headers(cookieHeader() === null ? {} : { cookie: cookieHeader() })
        },
        cookies: async () => {
          order.push('cookies materialization')
          if (state.renderStore) return state.renderStore.cookies
          const parsed = pageRequest().cookies
          return { get: key => parsed.get(key), getAll: () => parsed.getAll(), set: (key, value) => {
            if (state.readOnlyCookies) throw new Error('Read-only Server Component')
            parsed.set(key, value); jar.set(key, value)
          } }
        },
      }
      if (name === '@supabase/ssr') return { createServerClient: sdk }
      if (name === '@/lib/auth/config' || (name === './config' && args[0]?.filename.includes('/lib/auth/'))) return config
      if (name === '@/lib/auth/rate-limit') return { consumeAuthLimit: async () => {} }
      if (name === '@/lib/analytics/server') return { recordSuccessfulLogin: async () => {}, recordConfirmedSignup: async () => {} }
      if (name === '@/lib/supabase/auth-gateway') return { getAuthGateway: () => ({
        signInWithPassword: async ({ email }) => ({ data: verified(email.startsWith('a') ? 'A' : 'B'), error: null }),
        verifyOtp: async ({ email }) => ({ data: verified(email.startsWith('a') ? 'A' : 'B'), error: null }),
      }) }
      if (name === '@/lib/auth/recovery-grant') return {
        discardCurrentRecoveryGrant: async () => { calls.push('discard') },
        clearRecoveryCookie: response => response.cookies.set('ci-recovery-grant', '', { maxAge: 0 }),
        consumeRecoveryGrant: async () => state.grant ? { userId: users.A.id } : null,
      }
      if (name === '@/lib/supabase/recovery-auth') return { getRecoveryAuthGateway: () => ({
        replacePasswordAndRevokeSessions: async () => ({ error: state.resetError ? { code: 'weak_password' } : null }),
      }) }
      return load.call(this, name, ...args)
    }
    for (const file of ['./session-generation.ts', '../supabase/server.ts', '../supabase/proxy.ts', './student-state.ts',
      './account-continuity.ts', './mutation-context.ts', './request.ts', './response.ts',
      '../../app/api/auth/login/route.ts', '../../app/api/auth/confirm-email/route.ts', '../../app/api/auth/logout/route.ts',
      '../../app/api/auth/reset-password/route.ts']) delete require.cache[require.resolve(file)]
    const generation = require('./session-generation.ts'), server = require('../supabase/server.ts')
    const proxy = require('../supabase/proxy.ts'), student = require('./student-state.ts')
    const continuity = require('./account-continuity.ts'), mutation = require('./mutation-context.ts')
    const apply = response => applyResponseCookies(jar, response)
    const post = (route, body, token) => require(`../../app/api/auth/${route}/route.ts`).POST(new Request(`http://localhost:3000/api/auth/${route}`, {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
        ...(token ? { 'x-campus-account-continuity': token } : {}) }, body: JSON.stringify(body),
    }))
    await run({ jar, clients, calls, order, state, users, generation, server, proxy, student, continuity, mutation, apply, post,
      response: () => NextResponse.json({}), pageRequest,
      renderResponse: response => { state.renderStore = createRenderRequestStore(response); return state.renderStore },
      rawCookieHeader: value => { rawCookieHeader = value } })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}
module.exports = { fixture, applyResponseCookies, createRenderRequestStore, assertInvalidDownstream }
