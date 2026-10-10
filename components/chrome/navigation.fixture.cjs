// components/chrome/navigation.fixture.cjs — Deterministic session requests and component state; browser tests cover portals/focus.
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const ts = require('typescript')
require('react/jsx-runtime')

const nodes = element => !element || typeof element !== 'object' ? []
  : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx']
  const cache = new Map(Object.entries(require.cache))
  const saved = new Map(['window', 'document', 'fetch'].map(key => [key, global[key]]))
  const states = new Map(), effects = [], requests = [], subscriptions = new Set()
  let active, index, pathname = '/', width = 390, presentation = { signedIn: false, version: 0 }
  const win = new EventTarget(), doc = new EventTarget(), media = new EventTarget()
  doc.visibilityState = 'visible'
  Object.defineProperty(media, 'matches', { get: () => width >= 1200 })
  win.matchMedia = () => media
  const hooks = { ...React,
    useContext: () => presentation,
    useState(initial) {
      const state = active, slot = index++
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value }]
    },
    useEffect(effect, deps) {
      const state = active, slot = index++
      const old = state[slot]
      if (!old || !deps || !old.deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        const next = { deps, cleanup: null }; state[slot] = next
        effects.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const placeholder = name => ({ [name]: function ({ children }) { return children } })[name]
  const sheet = Object.fromEntries(['Sheet', 'SheetContent', 'SheetDescription', 'SheetTitle', 'SheetTrigger'].map(name => [name, placeholder(name)]))
  const logout = { pending: false, error: null, logout: async () => {} }
  try {
    Object.assign(global, { window: win, document: doc, fetch: (url, options) => {
      const task = deferred(); requests.push({ url, options, ...task }); return task.promise
    } })
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'react') return hooks
      if (name === 'next/link') return ({ href, children, prefetch, ...props }) => React.createElement('a', { href, ...props }, children)
      if (name === 'next/image') return props => React.createElement('img', props)
      if (name === 'next/navigation') return { usePathname: () => pathname }
      if (name === '@/lib/auth/client-events') return { onStudentChange: callback => {
        subscriptions.add(callback); return () => subscriptions.delete(callback)
      } }
      if (name === '@/components/auth/LogoutButton' || name === './LogoutButton') return {
        useLogoutAction: () => logout,
        LogoutControl: () => React.createElement('button', { onClick: logout.logout }, 'Log out'),
      }
      if (name === '@/components/ui/sheet') return sheet
      return load.call(this, name, ...args)
    }
    const { NavigationSessionProvider } = require('../auth/NavigationSession.tsx')
    const { Nav } = require('./Nav.tsx')
    const { Footer } = require('./Footer.tsx')
    const render = (component, props = {}) => {
      if (!states.has(component)) states.set(component, [])
      active = states.get(component); index = 0
      const tree = component(props)
      while (effects.length) effects.shift()()
      return tree
    }
    const sync = () => { presentation = render(NavigationSessionProvider).props.value }
    const settle = async () => { await new Promise(setImmediate); sync() }
    const respond = async (body, status = 200, request = requests.at(-1)) => {
      if (body?.enabled === true && body.signedIn === true && !('continuityToken' in body)) {
        body = { ...body, continuityToken: 'fixture-rendered-session' }
      }
      request.resolve(new Response(JSON.stringify(body), { status })); await settle()
    }
    sync(); sync()
    await run({ requests, respond, settle, render, Nav, Footer, sheet, win, doc,
      nav: () => render(Nav), footer: () => render(Footer, { year: 2026 }),
      state: () => presentation, change: () => { for (const callback of subscriptions) callback(); sync() },
      path: value => { pathname = value }, resize: value => { width = value; media.dispatchEvent(new Event('change')) },
    })
  } finally {
    for (const state of states.values()) for (const slot of state) slot?.cleanup?.()
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const [key, value] of saved) { if (value === undefined) delete global[key]; else global[key] = value }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}
module.exports = { fixture, nodes }
