const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { NextResponse } = require('next/server')
const { readVerifiedStudentUser } = require('./verified-user.ts')
const { withAuthDiagnostics } = require('./route-boundary.ts')
const { AUTH_MESSAGES } = require('./constants.ts')

const generation = 'a'.repeat(32), other = 'b'.repeat(32)
async function fixture(run, legacy = false) {
  const load = Module._load, env = { ...process.env }, originalError = console.error
  const file = require.resolve('../supabase/server.ts')
  const root = legacy ? 'sb-127-auth-token' : `ci-student-auth-${generation}`
  const jar = new Map([[root, 'fixture-stale'], [`${root}.0`, 'fixture-stale-zero'], [`${root}.1`, 'fixture-stale-one'],
    [`ci-student-auth-${other}`, 'unrelated-student-namespace'], ['admin_session', 'unrelated-admin']])
  if (!legacy) jar.set('ci-student-session-generation', generation)
  let answer = { data: { user: null }, error: { name: 'AuthApiError', code: 'bad_jwt' } }
  const logs = []
  try {
    Object.assign(process.env, { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' })
    console.error = (...args) => logs.push(args)
    Module._load = function(name, ...args) {
      if (name === 'next/headers') return {
        headers: async () => new Headers({ cookie: Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ') }),
        cookies: async () => ({ getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
          set() { throw new Error('read-only cookie store') } }),
      }
      if (name === '@supabase/ssr') return { createServerClient: (_url, _key, options) => ({ auth: {
        getUser: async () => answer,
        getClaims: async () => { throw new Error('must not accept claims after invalid credentials') },
      } }) }
      return load.call(this, name, ...args)
    }
    delete require.cache[file]
    const { createClient } = require(file)
    const check = (explicit = false) => withAuthDiagnostics('/api/auth/session', async () => {
      const response = NextResponse.json({})
      const client = await createClient(explicit ? response : undefined)
      const user = await readVerifiedStudentUser(client)
      return NextResponse.json({ signedIn: user !== null }, { headers: response.headers })
    })
    await run({ check, jar, root, logs, answer: value => { answer = value } })
  } finally {
    Module._load = load; console.error = originalError; delete require.cache[file]
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

for (const legacy of [false, true]) test(`bad_jwt clears only the affected ${legacy ? 'legacy' : 'selected'} cookies at the response boundary`, async () => fixture(async f => {
  const response = await f.check()
  assert.deepEqual(await response.json(), { signedIn: false })
  const cookies = response.cookies.getAll()
  assert.deepEqual(cookies.map(c => c.name).sort(), [f.root, `${f.root}.0`, `${f.root}.1`].sort())
  assert.ok(cookies.every(c => c.value === '' && c.maxAge === 0 && c.httpOnly && c.secure && c.sameSite === 'lax'))
  assert.equal(response.cookies.has('ci-student-session-generation'), false, 'never enable legacy fallback by removing the selector')
  assert.equal(response.cookies.has(`ci-student-auth-${other}`), false)
  assert.equal(response.cookies.has('admin_session'), false)
  assert.equal(f.logs.length, 0)
}, legacy))

test('other confirmed invalid credentials clear cookies on an explicitly response-bearing client', async () => fixture(async f => {
  for (const error of [{ name: 'AuthSessionMissingError' }, ...['refresh_token_not_found', 'refresh_token_already_used',
    'session_expired', 'session_not_found', 'user_not_found', 'user_banned'].map(code => ({ name: 'AuthApiError', code }))]) {
    f.answer({ data: { user: null }, error })
    const response = await f.check(true)
    assert.equal(response.status, 200)
    assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith(`${f.root}=;`) && cookie.includes('Max-Age=0')),
      'the actual HTTP response clears the active cookie')
  }
}))

test('network and ambiguous failures retain cookies, return unavailable and log a reference', async () => fixture(async f => {
  for (const error of [{ name: 'AuthRetryableFetchError', message: 'private network details' },
    { name: 'AuthApiError', code: 'unexpected_failure', message: 'private details' }]) {
    f.answer({ data: { user: null }, error })
    const response = await f.check()
    const body = await response.json()
    assert.equal(response.status, 503)
    assert.equal(body.error, AUTH_MESSAGES.unavailable)
    assert.equal(response.cookies.getAll().length, 0)
    assert.equal(f.jar.get(f.root), 'fixture-stale')
    assert.equal(f.logs.at(-1)[1].reference, body.reference)
    assert.equal(f.logs.at(-1)[1].step, 'identity')
  }
}))
