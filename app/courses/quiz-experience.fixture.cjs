// Deterministic component transitions; real browser focus/portals are checked separately.
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const ts = require('typescript')
const { elementNodes } = require('../../lib/test/element-walker.cjs')

require('react/jsx-runtime')

const nodes = element => elementNodes(element)
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(run, initialProps = {}) {
  const load = Module._load, tsx = Module._extensions['.tsx']
  const cache = new Map(Object.entries(require.cache))
  const globals = new Map(['window', 'document', 'HTMLElement', 'setInterval', 'clearInterval'].map(k => [k, global[k]]))
  const dateNow = Date.now
  const states = new Map(), effects = [], intervals = new Map(), writes = [], destinations = [], tokens = [], statusHandlers = []
  let active, index, now = 0, intervalId = 0, idCounter = 0, confirm = false, responder, bankLoads = 0
  const win = new EventTarget(), doc = new EventTarget()
  const history = [{ nextRouterState: 'preserved' }]
  const dataset = {}
  class Element { isConnected = true; hidden = false; focus() { if (this.isConnected && !this.hidden) doc.activeElement = this } }
  let desktop = false
  doc.activeElement = new Element()
  doc.body = new Element()
  win.matchMedia = () => ({ get matches() { return desktop }, addEventListener() {}, removeEventListener() {} })
  doc.visibilityState = 'visible'
  Object.assign(doc.body, { setAttribute: (key, value) => { dataset[key] = value }, removeAttribute: key => { delete dataset[key] } })
  win.location = { href: 'http://localhost/courses/test/quiz', replace: url => destinations.push(url) }
  win.history = { get state() { return history.at(-1) }, pushState: value => history.push(value),
    back: () => { history.pop(); win.dispatchEvent(new Event('popstate')) } }
  win.confirm = () => confirm
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const memo = (factory, deps) => {
    const slot = index++
    if (!active[slot] || !depsEqual(active[slot].deps, deps)) active[slot] = { deps, value: factory() }
    return active[slot].value
  }
  const hooks = { ...React,
    useState(initial) {
      const state = active, slot = index++
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
      return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next }]
    },
    useRef: initial => memo(() => ({ current: initial }), []),
    useId: () => memo(() => `:fixture-id-${++idCounter}:`, []),
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(effect, deps) {
      const state = active, slot = index++
      if (!state[slot] || !depsEqual(state[slot].deps, deps)) {
        const previous = state[slot]
        const next = { deps, cleanup: null }
        state[slot] = next
        effects.push(() => { previous?.cleanup?.(); next.cleanup = effect() })
      }
    },
    // The shared breakpoint store answers synchronously; a fixture flag stands in for the viewport.
    useSyncExternalStore(subscribe, getSnapshot) { index++; return getSnapshot() },
  }
  const placeholder = name => ({ [name]: function () {} })[name]
  const mock = { './QuestionScreen': { QuestionScreen: placeholder('QuestionScreen') },
    './ResultsScreen': { ResultsScreen: placeholder('ResultsScreen') },
    './ReviewScreen': { ReviewScreen: placeholder('ReviewScreen') },
    './ReportQuestionDialog': { ReportQuestionDialog: placeholder('ReportQuestionDialog') },
    './AssessmentConfirmation': { AssessmentConfirmation: placeholder('AssessmentConfirmation') },
    './attemptRecording': { createQuizAttemptRecorder: (token, onStatus) => {
      tokens.push(token)
      statusHandlers.push(onStatus)
      return { begin: (...args) => { writes.push(['start', ...args]); return `attempt-${writes.filter(write => write[0] === 'start').length}` },
        select: (...args) => writes.push(['record', ...args]), finish: value => writes.push(['finish', value]) }
    } },
    './liveBank': { loadFreshQuiz: async () => { bankLoads++; return responder() } },
  }
  const questions = ['One', 'Two', 'Three'].map((section, i) => ({ id: i + 1,
    questionId: `question-${i}`, itemId: `item-${i}`, question: `Question ${i}`, section, publishedRevision: 1,
    options: ['A', 'B'], correctAnswer: 1 }))
  const props = { continuityToken: 'page-A', questions, sections: ['One', 'Two', 'Three'],
    timerSeconds: 60, maxQuestions: 2, totalInBank: 3,
    courseSlug: 'test', courseHref: '/courses/test', courseContentKey: 'test', courseCode: 'TST', courseTitle: 'Test course',
    repositoryCourseId: 'course-1', repositoryOnly: false, ...initialProps }
  const fresh = { ...props, bankSize: props.questions.length,
    attemptSize: Math.min(props.maxQuestions, props.questions.length) }
  responder = () => fresh
  try {
    Object.assign(global, { window: win, document: doc, HTMLElement: Element,
      setInterval: fn => { const id = ++intervalId; intervals.set(id, fn); return id },
      clearInterval: id => intervals.delete(id) })
    Date.now = () => now
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function (name, ...args) {
      if (name === 'react') return hooks
      return mock[name] || load.call(this, name, ...args)
    }
    const { QuizClient } = require('./[slug]/quiz/QuizClient.tsx')
    const { IntroScreen } = require('./[slug]/quiz/IntroScreen.tsx')
    // `prepare` runs between render and effects, where a test seeds the refs a real DOM would have attached.
    const render = (component = QuizClient, input = props, prepare) => {
      if (!states.has(component)) states.set(component, [])
      active = states.get(component); index = 0
      const result = component(input)
      prepare?.(result)
      while (effects.length) effects.shift()()
      return result
    }
    // A screen that left the tree: its effects clean up and its next render mounts fresh, as React would.
    const unmount = component => {
      for (const slot of states.get(component) ?? []) slot?.cleanup?.()
      states.delete(component)
    }
    const child = name => nodes(render()).find(node => node.type?.name === name)
    const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); render() }
    const briefing = () => render(IntroScreen, child('IntroScreen').props)
    const pressStart = async () => {
      nodes(briefing()).find(node => node.type === 'button').props.onClick()
      await settle()
    }
    // The readiness control is the shared Checkbox; its node is the one carrying onCheckedChange.
    const readiness = () => nodes(briefing()).find(node => node.props?.onCheckedChange !== undefined)
    const acknowledge = () => readiness().props.onCheckedChange(true)
    const start = async () => {
      acknowledge()
      await pressStart()
    }
    await run({ props, fresh, render, unmount, child, settle, start, briefing, pressStart, readiness, acknowledge, IntroScreen, writes, tokens, intervals, dataset,
      win, doc, destinations, history, setNow: value => { now = value },
      tick: () => { for (const tick of intervals.values()) tick() },
      respond: fn => { responder = fn }, bankLoads: () => bankLoads,
      confirmBack: value => { confirm = value },
      Element, setDesktop: value => { desktop = value },
      closeEvent: () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }),
      recordingStatus: value => { for (const handler of statusHandlers) handler(value) },
      dialog: kind => nodes(render()).find(node => node.type?.name === 'AssessmentConfirmation' && node.props.kind === kind) })
  } finally {
    for (const state of states.values()) for (const slot of state) slot?.cleanup?.()
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const [key, value] of globals) { if (value === undefined) delete global[key]; else global[key] = value }
    Date.now = dateNow
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}
module.exports = { fixture, nodes, deferred }
