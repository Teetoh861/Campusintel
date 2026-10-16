const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextRequest } = require('next/server')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const calls = [], state = { enabled: true, claims: { data: null, error: null }, throws: false,
    lifecycle: { status: 'active', deletionAllowed: true }, rpcError: false }
  try {
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config') return {
        isStudentAuthEnabled: () => state.enabled,
        getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'fixture-publishable' }),
      }
      if (name === '@supabase/ssr') return { createServerClient: (_url, _key, options) => {
        calls.push('client')
        return { auth: { getClaims: async () => {
          calls.push('claims')
          options.cookies.setAll([{ name: 'sb-fixture-auth-token', value: 'rotated', options: {} }], { 'X-Refresh-Test': 'preserved' })
          if (state.throws) throw new Error('private provider failure')
          return state.claims
        } }, rpc: async operation => {
          calls.push('lifecycle'); assert.equal(operation, 'read_account_lifecycle')
          return { data: state.lifecycle, error: state.rpcError ? {} : null }
        } }
      } }
      return load.call(this, name, ...args)
    }
    delete require.cache[require.resolve('../supabase/proxy.ts')]
    const { refreshStudentSession } = require('../supabase/proxy.ts')
    await run({ state, calls, request: (path = '/dashboard', method = 'GET') => refreshStudentSession(
      new NextRequest('http://localhost:3000' + path, { method })) })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('proxy refreshes cookies without anonymous lifecycle calls when claims are missing, malformed or rejected', async () => fixture(async f => {
  for (const claims of [
    { data: null, error: null }, { data: {}, error: null },
    { data: { claims: {} }, error: null }, { data: { claims: { sub: '' } }, error: null },
    { data: { claims: { sub: 123 } }, error: null },
    { data: { claims: { sub: randomUUID() } }, error: { code: 'invalid_jwt' } },
  ]) {
    f.state.claims = claims; f.calls.length = 0
    const response = await f.request('/login')
    assert.deepEqual(f.calls, ['client', 'claims'])
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated')
  }
  f.state.throws = true; f.calls.length = 0
  assert.equal((await f.request()).headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(f.calls, ['client', 'claims'])
}))

test('proxy reads lifecycle only for authenticated page GETs and preserves restricted redirects and refreshed cookies', async () => fixture(async f => {
  f.state.claims = { data: { claims: { sub: randomUUID() } }, error: null }
  for (const status of ['scheduled', 'expired']) {
    f.state.lifecycle = { status, deadline: '2026-11-15T00:00:00Z', requestId: randomUUID() }
    f.calls.length = 0
    const response = await f.request()
    assert.deepEqual(f.calls, ['client', 'claims', 'lifecycle'])
    assert.equal(response.headers.get('location'), 'http://localhost:3000/account/deletion')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.cookies.get('sb-fixture-auth-token').value, 'rotated')
  }
  for (const [path, method] of [['/account/deletion', 'GET'], ['/api/auth/session', 'GET'], ['/dashboard', 'POST']]) {
    f.calls.length = 0
    assert.equal((await f.request(path, method)).headers.get('location'), null)
    assert.deepEqual(f.calls, ['client', 'claims'])
  }
  for (const lifecycle of [{ status: 'active', deletionAllowed: true }, { status: 'signed-out' }, null]) {
    f.state.lifecycle = lifecycle
    assert.equal((await f.request()).headers.get('location'), null)
  }
  f.state.rpcError = true
  assert.equal((await f.request()).headers.get('Cache-Control'), 'private, no-store')
  f.state.enabled = false; f.calls.length = 0
  assert.equal((await f.request()).headers.get('location'), null)
  assert.deepEqual(f.calls, [])
}))
