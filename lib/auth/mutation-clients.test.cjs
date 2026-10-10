const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const saved = { window: global.window, fetch: global.fetch }
  const slots = new Map(), requests = [], navigation = { continuityToken: 'nav-A' }
  const state = { changed: false, reloads: 0, redirects: [], notifications: 0 }
  let active, index
  const hooks = {
    useState(initial) {
      const local = active, slot = index++
      if (!(slot in local)) local[slot] = typeof initial === 'function' ? initial() : initial
      return [local[slot], value => { local[slot] = typeof value === 'function' ? value(local[slot]) : value }]
    },
    useRef(initial) {
      const slot = index++
      if (!(slot in active)) active[slot] = { current: initial }
      return active[slot]
    },
  }
  const jsx = (type, props) => ({ type, props })
  const CoursePicker = () => null, ContentForm = () => null
  const mocks = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    './NavigationSession': { useNavigationSession: () => navigation },
    '@/lib/auth/client-events': { notifyStudentChange: () => { state.notifications++ } },
    '@/components/chrome/ui': { buttonClassName: () => '' },
    '@/components/chrome/Feedback': { Feedback: () => null },
    './CoursePicker': { CoursePicker }, './ContentForm': { ContentForm },
    './ContentList': { ContentList: () => null }, './ContentHistory': { ContentHistory: () => null },
  }
  try {
    global.window = { confirm: () => true, location: {
      reload: () => { state.reloads++ }, replace: path => { state.redirects.push(path) },
    } }
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options })
      if (options.method !== 'POST') return Response.json({ status: 'ok', data: [] })
      if (state.changed) return Response.json({ status: 'session-changed' }, { status: 409 })
      return Response.json(url === '/api/auth/logout' ? { success: true } : { status: 'ok', data: { lockVersion: 2 } })
    }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function (name, ...args) { return mocks[name] || load.call(this, name, ...args) }
    for (const file of ['../../components/auth/LogoutButton.tsx', '../../components/auth/useAuthSubmit.ts',
      '../../components/admin/OperatorWorkspace.tsx', '../operator/editor-client.ts']) delete require.cache[require.resolve(file)]
    const logout = require('../../components/auth/LogoutButton.tsx')
    const { OperatorWorkspace } = require('../../components/admin/OperatorWorkspace.tsx')
    const render = (component, props) => {
      if (!slots.has(component)) slots.set(component, [])
      active = slots.get(component); index = 0
      return component(props)
    }
    const nodes = element => !element || typeof element !== 'object' ? []
      : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
    await run({ logout, OperatorWorkspace, CoursePicker, ContentForm, render, nodes, navigation, state, requests })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('account logout freezes its rendered token and reconciles a changed session without success or retry', async () => fixture(async f => {
  f.render(f.logout.LogoutButton, { continuityToken: 'page-A' })
  f.navigation.continuityToken = 'nav-B'
  const control = f.render(f.logout.LogoutButton, { continuityToken: 'page-B' })
  f.state.changed = true
  await control.props.action.logout()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].options.headers['x-campus-account-continuity'], 'page-A')
  assert.equal(f.state.reloads, 1)
  assert.deepEqual(f.state.redirects, [])
  assert.equal(f.state.notifications, 0)
}))

test('navigation logout uses the token from its presentation, never a new token minted on click', async () => fixture(async f => {
  const oldAction = f.render(f.logout.useLogoutAction)
  f.navigation.continuityToken = 'nav-B'
  f.state.changed = true
  await oldAction.logout()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].options.headers['x-campus-account-continuity'], 'nav-A')
  assert.equal(f.state.reloads, 1)
  f.state.changed = false
  await f.render(f.logout.useLogoutAction).logout()
  assert.equal(f.requests[1].options.headers['x-campus-account-continuity'], 'nav-B')
  assert.deepEqual(f.state.redirects, ['/login'])
  assert.equal(f.state.notifications, 1)
}))

test('operator workspace freezes its render token, stops changed-session mutations and offers a hard reload', async () => fixture(async f => {
  const course = '40000000-0000-4000-8000-000000000001'
  const props = { repositories: [{ id: course, content_key: 'course-a', is_shared: null }], institutional: [], continuityToken: 'operator-A' }
  let tree = f.render(f.OperatorWorkspace, props)
  f.nodes(tree).find(node => node.type === f.CoursePicker).props.onOpen(course)
  await new Promise(setImmediate)
  tree = f.render(f.OperatorWorkspace, { ...props, continuityToken: 'operator-B' })
  const save = f.nodes(tree).find(node => node.type === f.ContentForm).props.onSave
  f.state.changed = true
  await save({ action: 'create', courseId: course, kind: 'note', payload: { title: 'T', body: 'B' } })
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1)
  assert.equal(f.requests.at(-1).options.headers['x-campus-account-continuity'], 'operator-A')
  tree = f.render(f.OperatorWorkspace, props)
  assert.equal(tree.props.role, 'alert')
  assert.equal(f.nodes(tree).some(node => node.type === f.ContentForm), false)
  await save({ action: 'unpublish', itemId: course, expectedLockVersion: 1 })
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1)
  f.nodes(tree).find(node => node.type === 'button').props.onClick()
  assert.equal(f.state.reloads, 1)
}))
