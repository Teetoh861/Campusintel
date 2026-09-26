// lib/auth/session-presentation.test.cjs — Lookup failure is not confirmed sign-out; refresh metadata survives.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('session endpoint remotely validates signed-in state and rejects a revoked but unexpired session', async () => {
  const original = Module._load
  const file = require.resolve('../../app/api/auth/session/route.ts')
  const stateFile = require.resolve('./student-state.ts')
  let enabled = true, outcome = { data: { user: null }, error: null }, throws = false, reads = 0, claimReads = 0
  let sessionId = 'fixture-session'
  let writeClearingCookie = false, writeRotationCookie = false
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => enabled }
      if (name === '@/lib/auth/account-continuity') return {
        matchesAccountContinuityToken: (token, userId, liveSessionId) => token === `page:${userId}:${liveSessionId}`,
      }
      if (name === '@/lib/supabase/server') return { createClient: async response => {
        reads++
        response.headers.set('X-Refresh-Test', 'preserved')
        if (throws) throw new Error('private configuration detail')
        return { auth: {
          // This models an unexpired JWT; continuity claims are read only after remote getUser.
          getClaims: async () => {
            claimReads++
            if (writeRotationCookie) response.cookies.set('sb-test-auth-token', 'rotated', { httpOnly: true })
            return { data: { claims: { sub: 'fixture-user', session_id: sessionId } }, error: null }
          },
          getUser: async () => {
            if (writeClearingCookie) response.cookies.set('sb-test-auth-token', '', { httpOnly: true, maxAge: 0 })
            return outcome
          },
        } }
      } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]; delete require.cache[stateFile]
    const { GET } = require(file)
    const plain = () => GET(new Request('http://localhost/api/auth/session'))
    const compared = token => GET(new Request('http://localhost/api/auth/session', {
      headers: { 'x-campus-account-continuity': token },
    }))
    enabled = false
    assert.deepEqual(await (await plain()).json(), { enabled: false, signedIn: false })
    assert.deepEqual(await (await compared('page:fixture-user:fixture-session')).json(), { enabled: false, signedIn: false, sameAccount: false })
    assert.equal(reads, 0)
    enabled = true
    for (const signedIn of [false, true]) {
      outcome = { data: { user: signedIn ? { id: 'fixture-user' } : null }, error: null }
      const response = await plain()
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { enabled: true, signedIn })
    }
    assert.equal(claimReads, 0, 'plain status never needs JWT claims')
    assert.deepEqual(await (await compared('page:fixture-user:fixture-session')).json(), { enabled: true, signedIn: true, sameAccount: true })
    assert.deepEqual(await (await compared('page:other-user:fixture-session')).json(), { enabled: true, signedIn: true, sameAccount: false })
    sessionId = 'new-session'
    assert.deepEqual(await (await compared('page:fixture-user:fixture-session')).json(), { enabled: true, signedIn: true, sameAccount: false })
    sessionId = ''
    const malformedClaims = await compared('page:fixture-user:fixture-session')
    assert.equal(malformedClaims.status, 503)
    sessionId = 'fixture-session'
    writeRotationCookie = true
    const refreshed = await compared('page:fixture-user:fixture-session')
    assert.deepEqual(await refreshed.json(), { enabled: true, signedIn: true, sameAccount: true })
    assert.match(refreshed.headers.get('Set-Cookie'), /sb-test-auth-token=rotated/)
    writeRotationCookie = false
    writeClearingCookie = true
    outcome = { data: { user: null }, error: { name: 'AuthSessionMissingError' } }
    const revoked = await compared('page:fixture-user:fixture-session')
    assert.equal(revoked.status, 200)
    assert.deepEqual(await revoked.json(), { enabled: true, signedIn: false, sameAccount: false })
    assert.match(revoked.headers.get('Set-Cookie'), /sb-test-auth-token=;/)
    assert.match(revoked.headers.get('Set-Cookie'), /HttpOnly/i)
    assert.equal(claimReads, 5)
    for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'user_not_found']) {
      outcome = { data: { user: null }, error: { name: 'AuthApiError', code } }
      const expired = await plain()
      assert.equal(expired.status, 200)
      assert.deepEqual(await expired.json(), { enabled: true, signedIn: false })
    }
    for (const thrown of [false, true]) {
      throws = thrown
      outcome = { data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'private network detail' } }
      const response = await plain()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'Something went wrong. Please try again.' })
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
      if (thrown) assert.equal(response.headers.get('Set-Cookie'), null)
      else assert.match(response.headers.get('Set-Cookie'), /HttpOnly/i)
    }
    throws = false; writeClearingCookie = false
    for (const result of [undefined, {}, { data: undefined, error: null }, { data: {}, error: null },
      { data: { user: undefined }, error: null }, { data: { user: {} }, error: null },
      { data: { user: { id: '' } }, error: null }, { data: { user: { id: 42 } }, error: null }]) {
      outcome = result
      const response = await plain()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'Something went wrong. Please try again.' })
    }
    assert.equal(claimReads, 5)
  } finally { Module._load = original; delete require.cache[file]; delete require.cache[stateFile] }
})

test('account redirects missing or revoked sessions but renders unavailable for lookup failure', async () => {
  const fs = require('node:fs'), ts = require('typescript')
  const original = Module._load, originalTsx = Module._extensions['.tsx']
  const file = require.resolve('../../app/account/page.tsx')
  const stateFile = require.resolve('./student-state.ts')
  let result, enabled = true
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => enabled }
      if (name === '@/lib/auth/account-continuity') return {
        issueAccountContinuityToken: (userId, liveSessionId) => `page:${userId}:${liveSessionId}`,
      }
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfile: async () => ({
        status: 'complete', selection: {
          department: { id: 'department', label: 'Fixture department', isActive: true },
          academicLevel: { id: 'level', label: 'Fixture level', isActive: true },
          academicPeriod: { id: 'period', label: 'Fixture period', isActive: true },
        },
      }) }
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ auth: {
        getUser: async () => {
          if (result instanceof Error) throw result
          return result
        },
        getClaims: async () => ({ data: { claims: { sub: 'fixture-user', session_id: 'fixture-session' } }, error: null }),
      } }) }
      if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]; delete require.cache[stateFile]
    const page = require(file).default
    for (const outcome of [new Error('network'), { data: { user: null }, error: { name: 'UnexpectedError' } }, { data: { user: { id: 'missing-email' } }, error: null }]) {
      result = outcome
      const rendered = await page()
      assert.equal(rendered.props.children.props.message, 'Something went wrong. Please try again.')
    }
    for (const error of [null, { name: 'AuthSessionMissingError' }, { name: 'AuthApiError', code: 'refresh_token_not_found' }]) {
      result = { data: { user: null }, error }
      await assert.rejects(page, /redirect:\/login\?next=%2Faccount/)
    }
    result = { data: { user: { id: 'fixture-user', email: 'student@example.test' } }, error: null }
    assert.equal((await page()).props.children[1].props.children.join(''), 'Signed in as student@example.test')
    enabled = false; result = new Error('must not read')
    assert.equal((await page()).props.children.type.name, 'AuthUnavailable')
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    delete require.cache[file]; delete require.cache[stateFile]
  }
})
