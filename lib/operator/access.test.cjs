// lib/operator/access.test.cjs — The /admin page uses live Auth and the database role.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

async function fixture(run) {
  const originalLoad = Module._load
  const originalTs = Module._extensions['.ts']
  const originalTsx = Module._extensions['.tsx']
  const loaded = []
  let enabled = true
  let user = { id: '11111111-1111-4111-8111-111111111111' }
  let sessionError = null
  let profile = { role: 'operator' }
  let profileError = null
  let profileReads = 0
  let clientReads = 0
  let editorReads = 0
  let editorWrites = 0
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
    'server-only': {},
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } },
    '@/lib/auth/config': { isStudentAuthEnabled: () => enabled },
    '@/lib/auth/constants': { AUTH_PATHS: { login: '/login' }, OPERATOR_HOME_PATH: '/admin', AUTH_CONTINUITY_HEADER: 'x-campus-account-continuity' },
    '@/lib/auth/student-state': { getStudentSessionUser: async () => {
      if (sessionError) throw sessionError
      return user
    } },
    '@/lib/supabase/server': { createClient: async () => { clientReads++; return client } },
    '@/lib/auth/account-continuity': { issueAccountContinuityToken: () => 'fixture-operator-session' },
    'next/navigation': {
      redirect: path => { throw new Error('redirect:' + path) },
      notFound: () => { throw new Error('not-found') },
    },
    '@/components/auth/AuthShell': { AuthUnavailable: () => 'Authentication unavailable' },
    '@/lib/operator/editor-server': {
      readOperatorCourses: async () => { editorReads++; return { status: 'ok', data: { repositories: [], institutional: [] } } },
      readOperatorItems: async () => { editorReads++; return { status: 'ok', data: [] } },
      readOperatorHistory: async () => { editorReads++; return { status: 'ok', data: {} } },
      writeOperatorContent: async () => { editorWrites++; return { status: 'ok', data: { lockVersion: 2 } } },
    },
    '@/lib/operator/editor-request': { readEditorMutation: async () => ({ action: 'unpublish',
      itemId: '11111111-1111-4111-8111-111111111111', expectedLockVersion: 1 }), EditorRequestError: class extends Error {} },
    '@/components/admin/OperatorWorkspace': { OperatorWorkspace: () => 'Operator workspace' },
  }
  const liveContext = async () => {
    if (!enabled) return { status: 'unavailable' }
    try {
      const liveClient = await mocks['@/lib/supabase/server'].createClient()
      const liveUser = await mocks['@/lib/auth/student-state'].getStudentSessionUser()
      return liveUser ? { status: 'ready', context: { client: liveClient, user: liveUser, sessionId: 'fixture-session' } }
        : { status: 'signed-out' }
    } catch { return { status: 'unavailable' } }
  }
  mocks['@/lib/auth/mutation-context'] = {
    getLiveSessionContext: liveContext,
    getAuthenticatedMutationContext: async (_, token) => {
      const live = await liveContext()
      return live.status !== 'ready' ? live : token === 'fixture-operator-session' ? live : { status: 'session-changed' }
    },
  }
  try {
    const transpile = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._extensions['.ts'] = transpile
    Module._extensions['.tsx'] = transpile
    Module._load = function(name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    const load = file => { const path = require.resolve(file); loaded.push(path); delete require.cache[path]; return require(path) }
    const accessModule = load('./access.ts')
    const access = accessModule.getOperatorAccess
    mocks['@/lib/operator/access'] = accessModule
    const page = load('../../app/admin/page.tsx').default
    const editorRoute = load('../../app/api/admin/editor/route.ts')
    await run({ access, page, editorRoute, set: state => {
      if ('enabled' in state) enabled = state.enabled
      if ('user' in state) user = state.user
      if ('sessionError' in state) sessionError = state.sessionError
      if ('profile' in state) profile = state.profile
      if ('profileError' in state) profileError = state.profileError
    }, reads: () => ({ profileReads, clientReads, editorReads, editorWrites }) })
  } finally {
    Module._load = originalLoad
    if (originalTs) Module._extensions['.ts'] = originalTs
    else delete Module._extensions['.ts']
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

test('direct editor reads and writes recheck the live operator account', async () => fixture(async f => {
  const url = 'http://localhost/api/admin/editor?view=courses'
  const post = () => new Request(url, { method: 'POST', body: '{}', headers: { 'x-campus-account-continuity': 'fixture-operator-session' } })
  f.set({ user: null })
  assert.equal((await f.editorRoute.GET(new Request(url))).status, 401)
  assert.equal((await f.editorRoute.POST(post())).status, 401)
  f.set({ user: { id: '11111111-1111-4111-8111-111111111111' }, profile: { role: 'student' } })
  assert.equal((await f.editorRoute.GET(new Request(url))).status, 403)
  assert.equal((await f.editorRoute.POST(post())).status, 403)
  assert.equal(f.reads().editorReads, 0)
  assert.equal(f.reads().editorWrites, 0)
  f.set({ profile: { role: 'operator' } })
  assert.equal((await f.editorRoute.GET(new Request(url))).status, 200)
  assert.equal((await f.editorRoute.POST(post())).status, 200)
  assert.equal(f.reads().editorReads, 1)
  assert.equal(f.reads().editorWrites, 1)
  f.set({ sessionError: new Error('Auth unavailable') })
  assert.equal((await f.editorRoute.GET(new Request(url))).status, 503)
  assert.equal((await f.editorRoute.POST(post())).status, 503)
  assert.equal(f.reads().editorReads, 1)
  assert.equal(f.reads().editorWrites, 1)
}))

test('retired password endpoints cannot issue an admin cookie or accept credentials', async () => fixture(async () => {
  for (const route of ['login', 'logout']) {
    const { POST } = require('../../app/api/admin/' + route + '/route.ts')
    const response = POST(new Request('http://localhost/api/admin/' + route, {
      method: 'POST', body: JSON.stringify({ password: 'old-password' }),
    }))
    assert.equal(response.status, 410)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
}))
