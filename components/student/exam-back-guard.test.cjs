// components/student/exam-back-guard.test.cjs — During a timed exam the browser's back never leaves it (J1): one entry
// for the same address sits above the exam's own, a back step puts it straight back (the app router never sees that
// step) and asks "End exam?", a reload never stacks a second entry, and once the exam has ended the entry is taken away.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const KEY = 'practice-attempt:11111111-1111-4111-8111-111111111111'
const EXAM = 'http://localhost/courses/bua-216/quiz?attempt=11111111-1111-4111-8111-111111111111'

/** The hook in a simulated tab: history entries, popstate listeners and timers, driven by the test. */
async function tab({ entries = [{ state: { __NA: true, tree: 'exam' }, url: EXAM }], index = entries.length - 1 } = {}, run) {
  const original = Module._load, saved = global.window
  const listeners = [], timers = []
  let active = null
  const hooks = {
    useRef(value) { const n = active.index++; return active.slots[n] ??= { current: value } },
    useCallback(fn, deps) {
      const n = active.index++, prior = active.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) active.slots[n] = { deps, value: fn }
      return active.slots[n].value
    },
    useEffect(effect, deps) {
      const owner = active, n = owner.index++, prior = owner.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
        owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
      }
    },
  }
  const history = { entries, index, backs: 0, pushes: 0,
    get state() { return this.entries[this.index].state },
    pushState(state, _unused, url) {
      this.pushes += 1
      this.entries.splice(this.index + 1)
      this.entries.push({ state, url: url ?? this.entries[this.index].url })
      this.index += 1
      location.href = this.entries[this.index].url
    },
    back() { this.backs += 1; this.index -= 1; location.href = this.entries[this.index].url },
  }
  const location = { href: entries[index].url }
  global.window = { history, location,
    setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout: id => { timers[id - 1] = null },
    addEventListener: (type, fn, capture) => { listeners.push([type, fn, capture]) },
    removeEventListener: (type, fn) => { const at = listeners.findIndex(entry => entry[0] === type && entry[1] === fn)
      if (at !== -1) listeners.splice(at, 1) } }
  Module._load = function(name, ...args) {
    return name === 'react' ? { ...React, ...hooks } : original.call(this, name, ...args)
  }
  try {
    await withTsx(async () => {
      const { useExamBackGuard, isExamGuard } = require('./exam-back-guard.ts')
      const instance = { slots: [], effects: [], index: 0 }
      const asked = []
      let release = null
      const render = (activeExam = true, quiet = false) => {
        instance.index = 0; instance.effects = []; active = instance
        try { release = useExamBackGuard(KEY, activeExam, quiet, () => asked.push(location.href)) } finally { active = null }
        for (const effect of instance.effects) effect()
      }
      const armNow = () => { for (const fn of timers.splice(0)) fn?.() }
      /** The browser goes back `steps` entries, then fires popstate at this page. */
      const back = (steps = 1) => {
        history.index -= steps
        location.href = history.entries[history.index].url
        const event = { stopped: false, stopImmediatePropagation() { this.stopped = true } }
        for (const [type, fn] of [...listeners]) if (type === 'popstate') fn(event)
        return event
      }
      try {
        await run({ render, armNow, back, history, location, listeners, asked, release: () => release(), isExamGuard })
      } finally { for (const value of instance.slots) value?.cleanup?.() }
    })
  } finally {
    Module._load = original
    if (saved === undefined) delete global.window; else global.window = saved
  }
}

test('armed after the router has written the exam entry: one entry above it, same address, its router state', () => tab({}, f => {
  f.render()
  assert.equal(f.history.entries.length, 1, 'nothing until the router has written the entry')
  f.armNow()
  assert.deepEqual(f.history.entries.map(entry => entry.url), [EXAM, EXAM])
  assert.deepEqual(f.history.state, { __NA: true, tree: 'exam', ciExamGuard: KEY })
  assert.equal(f.isExamGuard(f.history.state, KEY), true)
  assert.equal(f.isExamGuard(f.history.state, 'another-exam'), false)
  assert.ok(f.listeners.some(([type, , capture]) => type === 'popstate' && capture === true),
    'listening before the app router does')
}))

test('a back step asks "End exam?", puts the entry back and never reaches the app router', () => tab({}, f => {
  f.render()
  f.armNow()
  const event = f.back()
  assert.deepEqual([event.stopped, f.history.index, f.history.entries.length], [true, 1, 2])
  assert.deepEqual(f.asked, [EXAM])
  assert.deepEqual(f.history.state, { __NA: true, tree: 'exam', ciExamGuard: KEY })
}))

test('a back step that went further (a page entry before the exam) still comes back to the exam, at its address', () => tab({
  entries: [{ state: { __NA: true, tree: 'course' }, url: 'http://localhost/courses/bua-216' },
    { state: { __NA: true, tree: 'exam' }, url: EXAM }] }, f => {
  f.render()
  f.armNow()
  const event = f.back(2)
  assert.equal(event.stopped, true)
  assert.equal(f.location.href, EXAM, 'the exam\'s address is back')
  assert.deepEqual(f.history.state, { __NA: true, tree: 'exam', ciExamGuard: KEY }, 'with the exam\'s router state, not the course\'s')
  assert.equal(f.asked.length, 1)
}))

test('a reload on the guard entry keeps it: nothing is stacked twice', () => tab({
  entries: [{ state: { __NA: true, tree: 'exam' }, url: EXAM }, { state: { __NA: true, tree: 'exam', ciExamGuard: KEY }, url: EXAM }] }, f => {
  f.render()
  f.armNow()
  assert.equal(f.history.pushes, 0)
  f.back()
  assert.deepEqual([f.history.index, f.history.entries.length, f.asked.length], [1, 2, 1])
}))

test('while the exam is being handed in a back step changes nothing and asks nothing', () => tab({}, f => {
  f.render(true, true)
  f.armNow()
  const event = f.back()
  assert.deepEqual([event.stopped, f.history.index, f.asked.length], [true, 1, 0])
}))

test('once the exam has ended the entry is taken away, so the next back leaves the result as usual', () => tab({}, f => {
  f.render()
  f.armNow()
  f.release()
  f.release()
  assert.deepEqual([f.history.backs, f.history.index], [1, 0], 'taken away once')
  // The step that took it away, and any later one, reach the app router untouched.
  f.render(false)
  assert.equal(f.listeners.some(([type]) => type === 'popstate'), false, 'no longer listening once the exam has ended')
}))
