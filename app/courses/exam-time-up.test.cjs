// app/courses/exam-time-up.test.cjs — Time up on both timed exams: server-run practice and the free-pass exam.
// This device's zero can come before the server's deadline by one clock exchange (lib/entitlements/exam-clock.ts).
// At that zero the answers lock and anything unsaved is sent, but the exam is handed in only once the deadline has
// passed on the server too. Handed in before, the server takes it as an ordinary submission, and the result never
// says that time ran out. The clock and the network are simulated (so no clock exchange is among the requests); the
// screens are the real ones.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../lib/test/element-walker.cjs')

const Q = '22222222-2222-4222-8222-222222222222'
const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const TAB = '33333333-3333-4333-8333-333333333333'
const NOW = new Date().toISOString(), DEADLINE = new Date(Date.now() + 60_000).toISOString()
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }

/**
 * One exam screen on a simulated device. `device` is what the clock reads: the time left on this device's early
 * cutoff, and the time until the deadline has passed on the server (null for either while there is no reading).
 * `reply` answers each command the screen sends.
 */
async function mount(load, reply, run) {
  const original = Module._load, savedWindow = global.window, savedDocument = global.document
  let active = null, nextTimer = 0
  const device = { remaining: 60_000, untilPassed: 60_700 }
  const requests = [], timers = new Map(), ticks = [], listeners = [], records = new Map()
  const store = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value) },
    removeItem: key => { records.delete(key) } }
  const hooks = {
    useState(initial) {
      const owner = active, n = owner.index++
      if (!(n in owner.slots)) owner.slots[n] = typeof initial === 'function' ? initial() : initial
      return [owner.slots[n], value => { owner.slots[n] = typeof value === 'function' ? value(owner.slots[n]) : value }]
    },
    useRef(value) { const n = active.index++; return active.slots[n] ??= { current: value } },
    useMemo(factory, deps) {
      const n = active.index++, prior = active.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) active.slots[n] = { deps, value: factory() }
      return active.slots[n].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(effect, deps) {
      const owner = active, n = owner.index++, prior = owner.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
        owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
      }
    },
  }
  class SimulatedClock {
    constructor(options) { this.options = options }
    start() { this.options.onChange(device.remaining === null ? 'unsynced' : 'synced') }
    remaining() { return device.remaining }
    untilPassed() { return device.untilPassed }
    invalidate() {}
    resync() {}
    stop() {}
  }
  const post = async command => { requests.push(command); return reply(command) }
  global.window = { sessionStorage: store, localStorage: store, location: { assign() {}, pathname: '/exam' },
    setTimeout: (fn, ms) => { nextTimer += 1; timers.set(nextTimer, { run: fn, ms }); return nextTimer },
    clearTimeout: id => { timers.delete(id) }, setInterval: fn => ticks.push(fn), clearInterval() {},
    addEventListener: (type, fn) => { listeners.push([type, fn]) },
    removeEventListener: (type, fn) => { const at = listeners.findIndex(entry => entry[0] === type && entry[1] === fn)
      if (at !== -1) listeners.splice(at, 1) } }
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, ...hooks }
    if (name === '@/lib/entitlements/exam-tab') return { browserTabOptions: () => ({}),
      claimExamTabOnce: async () => ({ tab: TAB, sequence: 0, remember() {} }) }
    if (name === '@/lib/entitlements/exam-clock') return { ExamClock: SimulatedClock }
    if (name === '@/lib/practice/client') return { postPracticeCommand: post }
    if (name === '@/lib/entitlements/client') return { postDiscoveryCommand: post }
    return original.call(this, name, ...args)
  }
  try {
    await withTsx(async () => {
      const { Component, props } = load()
      const instance = { slots: [], effects: [], index: 0 }
      const render = () => {
        instance.index = 0; instance.effects = []; active = instance
        let tree
        try { tree = Component(props) } finally { active = null }
        for (const effect of instance.effects) effect()
        return tree
      }
      try {
        // The tab identity resolves, then the clock and the saving start.
        render(); await flush(); render(); await flush()
        await run({ device, requests, render, flush, props,
          sent: () => requests.map(command => command.action),
          /** The once-a-second countdown reads the clock. */
          tick: () => { for (const fn of [...ticks]) fn() },
          waits: () => [...timers.values()].map(timer => timer.ms),
          /** Let the timer planned for `ms` from now run. */
          elapse: async ms => {
            const due = [...timers.entries()].find(([, timer]) => timer.ms === ms)
            assert.ok(due, `a timer for ${ms} ms: ${[...timers.values()].map(timer => timer.ms)}`)
            timers.delete(due[0]); due[1].run(); await flush()
          },
          emit: type => { for (const [name, fn] of [...listeners]) if (name === type) fn() } })
      } finally { for (const value of instance.slots) value?.cleanup?.() }
    })
  } finally {
    Module._load = original
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument
  }
}

const saved = (answers, revision) => ({ status: 'saved', now: NOW, deadlineAt: DEADLINE, revision, answers })

function practice(reply, run) {
  const graded = []
  return mount(() => ({ Component: require('./[slug]/quiz/ActiveAttempt.tsx').ActiveAttempt,
    props: { continuityToken: 'verified-student', courseCode: 'GST 111', courseTitle: 'Use of English', repositoryOnly: false,
      courseHref: '/courses/use-of-english', serverNow: NOW, onGraded: (attempt, unsent) => graded.push([attempt, unsent]),
      attempt: { id: ATTEMPT, status: 'in_progress', saved: { revision: 0, answers: {} }, deadlineAt: DEADLINE,
        questions: [{ questionId: Q, prompt: 'Choose the appropriate word.', options: ['A', 'B'], section: 'Grammar' }] } } }),
  reply, f => run({ ...f, graded,
    screen: () => elementNodes(f.render()).find(node => node.type?.name === 'QuestionScreen').props }))
}

const TIMED_OUT = { status: 'graded', attempt: { id: ATTEMPT, status: 'timed_out', result: { timedOut: true, score: 1, total: 1 } } }
const practiceReply = command => command.action === 'submit' ? TIMED_OUT
  : saved(command.action === 'save' ? command.changes : {}, command.action === 'save' ? 1 : 0)

test('practice: at this device\'s zero the answers lock and the unsaved choice is sent; the hand-in waits for the server\'s deadline', async () => practice(practiceReply, async f => {
  assert.equal(f.screen().canAnswer, true)
  f.screen().onSelectOption(1)
  assert.deepEqual(f.sent(), [], 'the choice is waiting for its save')
  // A slow clock exchange (1.9 s): this device's zero comes that much before the server's deadline.
  f.device.remaining = -40
  f.device.untilPassed = 2_360
  f.tick()
  const atZero = f.screen()
  await f.flush()
  assert.equal(atZero.canAnswer, false)
  assert.equal(atZero.saveLine.text, 'Time is up. Getting your result…')
  assert.deepEqual(f.sent(), ['save'], 'the unsaved choice goes at once, while the server still takes it; nothing is handed in')
  assert.deepEqual(f.requests[0].changes, { [Q]: 1 })
  assert.ok(f.waits().includes(2_360), `the hand-in is planned for the server's deadline: ${f.waits()}`)
  // Back online in the meantime is no reason to hand in early either.
  f.emit('online')
  await f.flush()
  assert.equal(f.sent().includes('submit'), false)
  // A fresh reading in the meantime says the server's deadline is a little further off: the hand-in follows it.
  f.device.untilPassed = 300
  await f.elapse(2_360)
  assert.equal(f.sent().includes('submit'), false)
  assert.deepEqual(f.graded, [])
  f.device.untilPassed = -1
  await f.elapse(300)
  assert.deepEqual(f.sent(), ['save', 'submit'])
  assert.equal(f.graded.length, 1, 'the result the server closed at its deadline is shown')
  assert.equal(f.graded[0][0].result.timedOut, true)
  assert.equal(f.graded[0][1], false, 'and the choice sent at zero was saved, so nothing is reported as unsent')
}))

test('practice: once the deadline has passed on the server, or with no reading to wait on, time up hands in at once', async () => {
  for (const untilPassed of [0, -2_000, null]) {
    await practice(practiceReply, async f => {
      f.device.remaining = untilPassed === null ? null : -700
      f.device.untilPassed = untilPassed
      // Without a reading the countdown falls back to the page's own estimate: here, already past zero.
      f.props.serverNow = DEADLINE
      f.render()
      f.tick()
      f.render()
      await f.flush()
      assert.deepEqual(f.sent(), ['submit'], `until passed ${untilPassed}`)
      assert.equal(f.graded.length, 1)
    })
  }
})

test('practice: a hand-in that cannot reach the server is tried again after the wait, never before the server\'s deadline', async () => {
  let online = false
  await practice(command => command.action === 'submit' && !online ? { status: 'unavailable' } : practiceReply(command), async f => {
    f.device.remaining = -10
    f.device.untilPassed = 900
    f.tick()
    f.render()
    await f.flush()
    assert.deepEqual(f.sent(), [])
    f.device.untilPassed = -5
    await f.elapse(900)
    assert.deepEqual(f.sent(), ['submit'])
    assert.equal(f.screen().saveLine.text, 'Time is up. We’ll show your result as soon as you’re back online.')
    online = true
    f.emit('online')
    await f.flush()
    assert.deepEqual(f.sent(), ['submit', 'submit'])
    assert.equal(f.graded.length, 1)
  })
})

function freePassExam(reply, run) {
  return mount(() => ({ Component: require('./[slug]/preview/[kind]/DiscoveryExam.tsx').DiscoveryExam,
    props: { continuityToken: 'verified-student', courseSlug: 'financial-accounting-1', deadlineAt: DEADLINE, serverNow: NOW,
      savedSheet: { revision: 0, answers: {} }, initialResult: null,
      questions: [{ item_id: Q, prompt: 'Choose the appropriate word.', options: ['A', 'B'], section: 'Grammar' }] } }),
  reply, run)
}

test('free-pass exam: the same rule, and its result says that time ran out', async () => freePassExam(command =>
  command.action === 'submit-exam' ? { status: 'ready', preview: { kind: 'cbt', result: { score: 1, total: 1, timed_out: true } } }
    : saved(command.action === 'save-answers' ? command.changes : {}, command.action === 'save-answers' ? 1 : 0), async f => {
  const inputs = tree => elementNodes(tree).filter(node => node.type === 'input')
  inputs(f.render())[1].props.onChange()
  assert.deepEqual(f.sent(), [], 'the choice is waiting for its save')
  f.device.remaining = -40
  f.device.untilPassed = 2_360
  f.tick()
  const atZero = f.render()
  await f.flush()
  assert.equal(elementNodes(atZero).find(node => node.type === 'fieldset').props.disabled, true, 'answers are locked')
  assert.deepEqual(f.sent(), ['save-answers'], 'the unsaved choice goes at once; nothing is handed in')
  assert.deepEqual(f.requests[0].changes, { [Q]: 1 })
  assert.ok(f.waits().includes(2_360), `the hand-in is planned for the server's deadline: ${f.waits()}`)
  f.device.untilPassed = -1
  await f.elapse(2_360)
  assert.deepEqual(f.sent(), ['save-answers', 'submit-exam'])
  const result = f.render()
  assert.equal(result.type.name, 'ExamReview')
  assert.equal(result.props.result.timed_out, true)
}))
