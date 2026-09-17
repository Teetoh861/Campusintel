// lib/auth/session-presentation.test.cjs — Lookup failure is not confirmed sign-out; refresh metadata survives.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('session endpoint distinguishes disabled, signed out, signed in and lookup failure', async () => {
  const original = Module._load
  const file = require.resolve('../../app/api/auth/session/route.ts')
  let enabled = true, outcome = null, throws = false, reads = 0
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => enabled }
      if (name === '@/lib/supabase/server') return { createClient: async response => {
        reads++
        response.headers.set('X-Refresh-Test', 'preserved')
        response.cookies.set('sb-test-auth-token', '', { httpOnly: true, maxAge: 0 })
        if (throws) throw new Error('private configuration detail')
        return { auth: { getClaims: async () => outcome } }
      } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { GET } = require(file)
    enabled = false
    assert.deepEqual(await (await GET()).json(), { enabled: false, signedIn: false })
    assert.equal(reads, 0)
    enabled = true
    for (const signedIn of [false, true]) {
      outcome = { data: signedIn ? { claims: { sub: 'fixture-user' } } : null, error: null }
      const response = await GET()
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { enabled: true, signedIn })
    }
    for (const thrown of [false, true]) {
      throws = thrown
      outcome = { data: null, error: { message: 'private network detail' } }
      const response = await GET()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'Something went wrong. Please try again.' })
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      assert.equal(response.headers.get('X-Refresh-Test'), 'preserved')
      assert.match(response.headers.get('Set-Cookie'), /HttpOnly/i)
    }
    throws = false
    for (const data of [undefined, {}, { claims: {} }, { claims: { sub: '' } }, { claims: { sub: 42 } }]) {
      outcome = { data, error: null }
      const response = await GET()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'Something went wrong. Please try again.' })
    }
  } finally { Module._load = original; delete require.cache[file] }
})

test('account lookup failure renders unavailable instead of inventing signed-out state', async () => {
  const fs = require('node:fs'), ts = require('typescript')
  const original = Module._load, originalTsx = Module._extensions['.tsx']
  const file = require.resolve('../../app/account/page.tsx')
  let result, enabled = true
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => enabled }
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ auth: { getUser: async () => {
        if (result instanceof Error) throw result
        return result
      } } }) }
      if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const page = require(file).default
    for (const outcome of [new Error('network'), { data: { user: null }, error: { name: 'UnexpectedError' } }, { data: { user: { id: 'missing-email' } }, error: null }]) {
      result = outcome
      const rendered = await page()
      assert.equal(rendered.props.children.props.message, 'Something went wrong. Please try again.')
    }
    for (const error of [null, { name: 'AuthSessionMissingError' }]) {
      result = { data: { user: null }, error }
      await assert.rejects(page, /redirect:\/login\?next=%2Faccount/)
    }
    result = { data: { user: { email: 'student@example.test' } }, error: null }
    assert.match(JSON.stringify(await page()), /student@example.test/)
    enabled = false; result = new Error('must not read')
    assert.equal((await page()).props.children.type.name, 'AuthUnavailable')
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
})
