const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

// Exercise React's real server cache with a fresh dispatcher per simulated request. The traced production-server
// integration separately verifies Next's dispatcher, proxy forwarding and real Auth/database calls.
const React = require(path.join(path.dirname(require.resolve('react/package.json')), 'cjs/react.react-server.development.js'))
const internals = React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function fixture(run) {
  const original = Module._load, saved = { ...require.cache }, previousDispatcher = internals.A
  let request
  const start = (options = {}) => {
    request = { user: { id: uuid(1), email: 'ada@example.test' }, calls: [], lifecycle: { status: 'active', deletionAllowed: true },
      profile: { department_id: uuid(3), academic_level_id: uuid(4), academic_period_id: uuid(5), first_name: 'Ada',
        revision: 1, selection_confirmed_at: '2026-10-28T12:00:00Z' }, ...options }
    const types = new Map()
    internals.A = { getCacheForType(factory) { if (!types.has(factory)) types.set(factory, factory()); return types.get(factory) } }
    return request
  }
  try {
    Module._load = function(name, ...args) {
      if (name === 'react') return React
      if (name === 'next/headers') return { headers: async () => new Headers({ 'x-campus-student-render-path': '/dashboard' }),
        cookies: async () => ({ getAll: () => [] }) }
      if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) } }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true,
        getSupabaseConfig: () => ({ url: 'http://localhost:58121', key: 'fixture' }) }
      if (name === '@supabase/ssr') return { createServerClient: () => {
        const state = request
        return { auth: {
          // Deliberately wrong local user: identity must come from remote getUser and matching verified claims.
          getSession: async () => ({ data: { session: state.user ? { access_token: 'fixture-token', user: { id: uuid(99) } } : null }, error: null }),
          getUser: async jwt => { state.calls.push('getUser'); if (state.holdAuth) { assert.equal(jwt, 'fixture-token'); await new Promise(resolve => { state.releaseAuth = resolve }) } return { data: { user: state.user }, error: state.authError ?? null } },
          getClaims: async () => ({ data: { claims: { sub: state.user?.id, session_id: uuid(2) } }, error: null }),
        }, rpc: async name => {
          state.calls.push(name)
          if (name === 'read_account_lifecycle') return { data: state.lifecycle, error: null }
          assert.equal(name, 'read_student_context')
          const references = Object.fromEntries(['departments', 'academicLevels', 'academicPeriods'].map((key, index) =>
            [key, [{ id: uuid(index + 3), display_name: key, is_active: index !== 0 }]]))
          return { error: state.rpcError ?? null, data: { user_id: state.snapshotUser ?? state.user.id,
            session_id: state.snapshotSession ?? uuid(2), lifecycle: state.lifecycle,
            profile: state.lifecycle.status === 'active' ? state.profile : null, references } }
        }, from() { throw new Error('Unexpected serial table read') } }
      } }
      return original.call(this, name, ...args)
    }
    for (const name of ['./render-session.ts', './student-state.ts', '../supabase/server.ts', '../account/lifecycle.ts',
      '../profile/student-profile.ts', './server-chrome.ts']) delete require.cache[require.resolve(name)]
    const { createClient } = require('../supabase/server.ts')
    const { getStudentSessionContext, getStudentSessionUser } = require('./student-state.ts')
    const { getCurrentStudentProfile } = require('../profile/student-profile.ts')
    const { readStudentChromeState } = require('./server-chrome.ts')
    await run({ start, createClient, getStudentSessionContext, getStudentSessionUser, getCurrentStudentProfile, readStudentChromeState })
  } finally {
    internals.A = previousDispatcher; Module._load = original
    for (const key of Object.keys(require.cache)) if (!(key in saved)) delete require.cache[key]
    Object.assign(require.cache, saved)
  }
}

test('header, gate and concurrent page reads share one verified identity and one context RPC; next request starts fresh',
  async () => fixture(async f => {
    for (const id of [uuid(1), uuid(9), uuid(1)]) {
      const state = f.start({ user: { id, email: 'student@example.test' } })
      const [chrome, identity, user, profile] = await Promise.all([f.readStudentChromeState(),
        f.getStudentSessionContext(), f.getStudentSessionUser(), f.getCurrentStudentProfile()])
      assert.equal(chrome, 'signed-in'); assert.equal(identity.user.id, id); assert.equal(user.id, id)
      assert.equal(profile.status, 'complete'); assert.equal(profile.selection.department.isActive, false)
      assert.deepEqual(state.calls, ['getUser', 'read_student_context'])
      assert.equal(await f.createClient(), await f.createClient())
    }
  }))

test('revocation, deletion and mismatched snapshot identities fail closed without another account read', async () => fixture(async f => {
  for (const options of [{ rpcError: { code: '42501' } }, { user: null },
    { user: null, authError: { code: 'user_not_found' } }]) {
    const state = f.start(options)
    assert.equal(await f.getStudentSessionContext(), null)
    assert.equal(await f.readStudentChromeState(), 'signed-out')
    assert.equal((await f.getCurrentStudentProfile()).status, 'signed-out')
    assert.equal(state.calls.filter(call => call === 'getUser').length, 1)
  }
  for (const options of [{ snapshotUser: uuid(9) }, { snapshotSession: uuid(9) }, { rpcError: { code: 'XX000' } }]) {
    f.start(options)
    await assert.rejects(f.getStudentSessionContext)
    assert.equal(await f.readStudentChromeState(), 'unknown')
    assert.equal((await f.getCurrentStudentProfile()).status, 'unavailable')
  }
}))

test('scheduled and expired accounts retain the decision redirect and no completed profile; operators stay signed in', async () => fixture(async f => {
  for (const status of ['scheduled', 'expired']) {
    const state = f.start({ lifecycle: { status, deadline: '2026-11-15T00:00:00Z', requestId: uuid(8) } })
    await assert.rejects(f.readStudentChromeState, /redirect:\/account\/deletion/)
    assert.equal(await f.getStudentSessionContext(), null)
    assert.ok(await f.getStudentSessionContext(undefined, undefined, { allowRestricted: true }))
    assert.equal((await f.getCurrentStudentProfile()).status, 'signed-out')
    assert.deepEqual(state.calls, ['getUser', 'read_student_context'])
  }
  f.start({ lifecycle: { status: 'active', deletionAllowed: false } })
  assert.equal(await f.readStudentChromeState(), 'signed-in')
  assert.equal((await f.getCurrentStudentProfile()).status, 'complete')
}))

test('response-bound mutation checks stay fresh even inside a render cache', async () => fixture(async f => {
  const state = f.start(), response = { cookies: { set() {} }, headers: new Headers() }
  const client = await f.createClient(response)
  await f.getStudentSessionContext(response, client)
  await f.getStudentSessionContext(response, client)
  assert.deepEqual(state.calls, ['getUser', 'read_account_lifecycle', 'getUser', 'read_account_lifecycle'])
}))


test('the caller-only context read runs alongside Auth, and no verified context is released before Auth succeeds', async () => fixture(async f => {
  const state = f.start({ holdAuth: true })
  let settled = false
  const pending = f.getStudentSessionContext().then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(state.calls, ['getUser', 'read_student_context'])
  assert.equal(settled, false)
  state.releaseAuth()
  assert.equal((await pending).user.id, uuid(1), 'the unrelated local session.user is ignored')
}))
