// Controlled hook state for the production client controls; nested SSR uses real React.
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const saved = { window: global.window, requestAnimationFrame: global.requestAnimationFrame }
  const state = { reducedMotion: false }, frames = []
  let active
  const hooks = {
    useState(initial) {
      if (!active) return React.useState(initial)
      const instance = active, index = instance.index++
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial
      return [instance.slots[index], value => {
        instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value
      }]
    },
    useRef(initial) {
      if (!active) return React.useRef(initial)
      const index = active.index++
      if (!(index in active.slots)) active.slots[index] = { current: initial }
      return active.slots[index]
    },
    useMemo(factory, deps) {
      if (!active) return React.useMemo(factory, deps)
      active.index++; return factory()
    },
    useEffect(effect, deps) {
      if (!active) return React.useEffect(effect, deps)
      active.index++; active.effects.push(effect)
    },
  }
  try {
    global.window = { matchMedia: () => ({ matches: state.reducedMotion }) }
    global.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      return name === 'react' ? { ...React, ...hooks } : load.call(this, name, ...args)
    }
    const mount = (Component, props) => {
      const instance = { slots: [], props, index: 0, effects: [] }
      instance.render = () => {
        const previous = active
        active = instance; instance.index = 0; instance.effects = []
        let result
        try { result = Component(instance.props) } finally { active = previous }
        for (const effect of instance.effects) effect()
        return result
      }
      return instance
    }
    await run({ mount, state, nodes, React, html: renderToStaticMarkup,
      flushFrames: () => { while (frames.length) frames.shift()() } })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete global[name]; else global[name] = value
    }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}
module.exports = { fixture, nodes }
