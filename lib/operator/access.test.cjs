// lib/operator/access.test.cjs — The /admin page uses live Auth and the database role.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const loaded = []
  let enabled = true
  let user = { id: '11111111-1111-4111-8111-111111111111' }
  let sessionError = null
  let profile = { role: 'operator' }
  let profileError = null
  let profileReads = 0
  let clientReads = 0
  const client = { from(table) {
    assert.equal(table, 'profiles')
    return { select(columns) {
      assert.equal(columns, 'role')
      return { eq(column, value) {
        assert.equal(column, 'id')
        assert.equal(value, user.id)
        return { maybeSingle: async () => { profileReads++; return { data: profile, error: profileError } } }
      } }
    } }
  } }
  const mocks = {
    '@/lib/auth/config': { isStudentAuthEnabled: () => enabled },
    '@/lib/auth/student-state': { getStudentSessionUser: async () => {
      if (sessionError) throw sessionError
      return user
    } },
    '@/lib/supabase/server': { createClient: async () => { clientReads++; return client } },
    'next/navigation': {
      redirect: path => { throw new Error('redirect:' + path) },
      notFound: () => { throw new Error('not-found') },
    },
    '@/components/auth/AuthShell': { AuthUnavailable: () => 'Authentication unavailable' },
  }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    const load = file => { const path = require.resolve(file); loaded.push(path); delete require.cache[path]; return require(path) }
    const access = load('./access.ts').getOperatorAccess
    const page = load('../../app/admin/page.tsx').default
    await run({ access, page, set: state => {
      if ('enabled' in state) enabled = state.enabled
      if ('user' in state) user = state.user
      if ('sessionError' in state) sessionError = state.sessionError
      if ('profile' in state) profile = state.profile
      if ('profileError' in state) profileError = state.profileError
    }, reads: () => ({ profileReads, clientReads }) })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx
    else delete Module._extensions['.tsx']
    for (const path of loaded) delete require.cache[path]
  }
}

test('operator can enter /admin; a student cannot', async () => fixture(async f => {
  assert.equal((await f.access()).status, 'operator')
  assert.match(renderToStaticMarkup(await f.page()), /Content operations/)
  f.set({ profile: { role: 'student' } })
  assert.equal((await f.access()).status, 'forbidden')
  await assert.rejects(f.page(), /not-found/)
}))

test('signed-out, stale and unavailable sessions fail closed on every request', async () => fixture(async f => {
  f.set({ user: null })
  assert.equal((await f.access()).status, 'signed-out')
  await assert.rejects(f.page(), /redirect:\/login\?next=%2Fadmin/)
  f.set({ user: { id: '11111111-1111-4111-8111-111111111111' }, sessionError: new Error('stale session') })
  assert.equal((await f.access()).status, 'unavailable')
  assert.match(renderToStaticMarkup(await f.page()), /Authentication unavailable/)
  f.set({ sessionError: null, profileError: new Error('database unavailable') })
  assert.equal((await f.access()).status, 'unavailable')
  f.set({ profileError: null, profile: null })
  assert.equal((await f.access()).status, 'unavailable')
  const before = f.reads()
  f.set({ enabled: false })
  assert.equal((await f.access()).status, 'unavailable')
  assert.deepEqual(f.reads(), before)
}))

test('retired password endpoints cannot issue an admin cookie or accept credentials', async () => {
  for (const route of ['login', 'logout']) {
    const { POST } = require('../../app/api/admin/' + route + '/route.ts')
    const response = POST(new Request('http://localhost/api/admin/' + route, {
      method: 'POST', body: JSON.stringify({ password: 'old-password' }),
    }))
    assert.equal(response.status, 410)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
})
