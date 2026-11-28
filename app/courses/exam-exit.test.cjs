// app/courses/exam-exit.test.cjs — Owner items J1–J6 on both timed exams (server-run practice and the free pass).
// During an exam, leaving means ending it: Exit and the back button open "End exam?"; Keep going returns to the same
// question with the timer still running; End and see results hands the exam in once, even with a double tap or a retry
// after a lost response, and opens the result. The time left shows on the first render. Answers made while the
// connection is down say "Not saved yet.", are saved when it comes back, and go with the hand-in, each counted once.
// The network, the timers and the tab's history are simulated; the clock and the screens are the real ones.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../lib/test/element-walker.cjs')
// Read from the source: requiring tap-guard.ts here would cache it bound to React's own hooks, outside the harness.
const TAP_GUARD_MS = Number(/export const TAP_GUARD_MS = (\d+)/.exec(require('node:fs').readFileSync(
  require('node:path').join(__dirname, '../../components/student/tap-guard.ts'), 'utf8'))[1])

const Q = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222223']
const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const TAB = '33333333-3333-4333-8333-333333333333'
const NOW = '2026-11-27T09:00:00.000Z', DEADLINE = '2026-11-27T09:30:00.000Z'
// Option 1 is right for every question.
const RIGHT = 1
const flush = async () => { for (let n = 0; n < 25; n++) await Promise.resolve() }

/**
 * The server's rule for one exam sheet: one tab's changes apply only above the sequence it last had applied, and the
 * first hand-in grades the sheet once; every later command answers with that grading. `online` false drops the
 * request; `lose` applies the next hand-in but loses its response.
 */
function server(kind) {
  const s = { online: true, lose: false, sheet: {}, revision: 0, applied: new Map(), grades: 0, grading: null, requests: [] }
  const apply = ({ tab, sequence, changes }) => {
    const entries = Object.entries(changes).filter(([, option]) => option !== null)
    if (entries.length === 0 || sequence <= (s.applied.get(tab) ?? 0)) return
    for (const [question, option] of entries) s.sheet[question] = option
    s.revision += 1
    s.applied.set(tab, sequence)
  }
  const saved = () => ({ status: 'saved', now: NOW, deadlineAt: DEADLINE, revision: s.revision, answers: { ...s.sheet } })
  const score = () => Object.values(s.sheet).filter(option => option === RIGHT).length
  const graded = () => kind === 'practice' ? { status: 'graded', now: NOW, attempt: s.grading }
    : { status: 'ready', now: NOW, endsAt: DEADLINE, preview: { kind: 'cbt', deadline_at: DEADLINE, questions: [], saved: null,
      result: s.grading } }
  s.reply = command => {
    s.requests.push(command)
    if (!s.online) return { status: 'unavailable' }
    if (s.grading !== null) return graded()
    const action = command.action.replace(/-exam$|-answers$/, '')
    if (action === 'sync') return saved()
    if (action === 'save') { apply(command); return saved() }
    apply(command)
    s.grades += 1
    s.grading = kind === 'practice'
      ? { id: ATTEMPT, status: 'submitted', result: { timedOut: false, score: score(), total: Q.length }, sheet: { ...s.sheet } }
      : { score: score(), total: Q.length, timed_out: false }
    if (s.lose) { s.lose = false; return { status: 'unavailable' } }
    return graded()
  }
  s.sent = () => s.requests.map(command => command.action)
  return s
}

const questions = Q.map((id, n) => ({ id, prompt: `Question prompt ${n + 1}`, options: ['A', 'B', 'C'], section: 'Grammar' }))

/** One exam screen in a simulated tab. `hydrating`: the screen was rendered on the server and hydrated. */
async function mount(load, net, run, { hydrating = false } = {}) {
  const original = Module._load, savedWindow = global.window, savedDocument = global.document
  let active = null, now = 0, nextTimer = 0
  const timers = new Map(), ticks = [], listeners = [], records = new Map(), navigations = []
  const store = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value) },
    removeItem: key => { records.delete(key) } }
  // The screen under test runs on these; anything rendered to markup outside it runs on React's own.
  const hooks = {
    useState(initial) {
      if (!active) return React.useState(initial)
      const owner = active, n = owner.index++
      if (!(n in owner.slots)) owner.slots[n] = typeof initial === 'function' ? initial() : initial
      return [owner.slots[n], value => { owner.slots[n] = typeof value === 'function' ? value(owner.slots[n]) : value }]
    },
    useRef(value) { if (!active) return React.useRef(value); const n = active.index++; return active.slots[n] ??= { current: value } },
    useMemo(factory, deps) {
      if (!active) return React.useMemo(factory, deps)
      const n = active.index++, prior = active.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) active.slots[n] = { deps, value: factory() }
      return active.slots[n].value
    },
    useCallback(fn, deps) { return active ? hooks.useMemo(() => fn, deps) : React.useCallback(fn, deps) },
    useEffect(effect, deps) {
      if (!active) return React.useEffect(effect, deps)
      const owner = active, n = owner.index++, prior = owner.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
        owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
      }
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      if (!active) return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
      return hydrating ? getServerSnapshot() : getSnapshot()
    },
  }
  // The tab's history: the exam's own entry carries the app router's state.
  const href = load.href
  const history = { entries: [{ state: { __NA: true, tree: 'exam' }, url: href }], index: 0, backs: 0,
    get state() { return this.entries[this.index].state },
    pushState(state, _unused, url) {
      this.entries.splice(this.index + 1)
      this.entries.push({ state, url: url ?? this.entries[this.index].url })
      this.index += 1
    },
    back() { this.backs += 1; if (this.index > 0) this.index -= 1 },
  }
  global.window = { sessionStorage: store, localStorage: store, history,
    location: { href, pathname: new URL(href).pathname, assign: target => { navigations.push(target) } },
    setTimeout: (fn, ms = 0) => { nextTimer += 1; timers.set(nextTimer, { at: now + ms, run: fn }); return nextTimer },
    clearTimeout: id => { timers.delete(id) }, setInterval: fn => { ticks.push(fn); return ticks.length }, clearInterval() {},
    addEventListener: (type, fn) => { listeners.push([type, fn]) },
    removeEventListener: (type, fn) => { const at = listeners.findIndex(entry => entry[0] === type && entry[1] === fn)
      if (at !== -1) listeners.splice(at, 1) } }
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, ...hooks }
    if (name === '@/lib/entitlements/exam-tab') return { browserTabOptions: () => ({}),
      claimExamTabOnce: async () => ({ tab: TAB, sequence: 0, remember() {} }) }
    if (name === '@/lib/practice/client' || name === '@/lib/entitlements/client') {
      const post = async command => net.reply(command)
      return { postPracticeCommand: post, postDiscoveryCommand: post }
    }
    return original.call(this, name, ...args)
  }
  const advance = async ms => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      due[1].run()
      await flush()
    }
    now = target
    await flush()
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
        const first = render()
        await flush(); render(); await flush(); render()
        // The back guard arms once the page's router has written the exam entry's state.
        await advance(0)
        render()
        await run({ first, render, props, net, history, navigations, records, advance, flush,
          nodes: () => elementNodes(render()),
          emit: type => { for (const [name, fn] of [...listeners]) if (name === type) fn({}) },
          /** The browser's back button (or an iPhone swipe back): one entry back, then popstate on this page. */
          back: () => {
            history.index -= 1
            const event = { state: history.state, stopped: false, stopImmediatePropagation() { this.stopped = true } }
            for (const [name, fn] of [...listeners]) if (name === 'popstate') fn(event)
            return event
          } })
      } finally { for (const value of instance.slots) value?.cleanup?.() }
    })
  } finally {
    Module._load = original
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument
  }
}

// ---- The practice exam ---------------------------------------------------------------------------------------------

function practice(net, run, { received = { sentAt: performance.now() - 40, receivedAt: performance.now() }, ...options } = {}) {
  const graded = []
  const load = () => ({ Component: require('./[slug]/quiz/ActiveAttempt.tsx').ActiveAttempt,
    props: { continuityToken: 'verified-student', courseCode: 'GST 111', courseTitle: 'Use of English', repositoryOnly: false,
      courseHref: '/courses/use-of-english', serverNow: NOW, received, onGraded: (attempt, unsent) => graded.push([attempt, unsent]),
      attempt: { id: ATTEMPT, status: 'in_progress', saved: { revision: 0, answers: {} }, deadlineAt: DEADLINE,
        questions: questions.map(({ id, prompt, options: choices, section }) => ({ questionId: id, prompt, options: choices,
          section })) } } })
  load.href = `http://localhost/courses/use-of-english/quiz?attempt=${ATTEMPT}`
  return mount(load, net, f => run({ ...f, graded,
    screen: () => f.nodes().find(node => node.type?.name === 'QuestionScreen').props,
    dialog: () => f.nodes().find(node => node.type?.name === 'EndExamDialog').props }), options)
}

test('J5: the practice exam shows the time left on its first render: no "––:––", no "Checking the time left…"', async () => practice(server('practice'), async f => {
  const first = elementNodes(f.first).find(node => node.type?.name === 'QuestionScreen')
  assert.equal(first.props.timeLeft, 30 * 60, 'the server\'s deadline, from the server\'s own clock, before anything ran')
  const html = renderToStaticMarkup(React.createElement(first.type, first.props))
  assert.match(html, />30:00</)
  assert.match(html, /role="timer" aria-label="Time left 30 minutes 0 seconds"/)
  assert.doesNotMatch(html, /––:––|Checking the time left/)
  assert.doesNotMatch(first.props.saveLine?.text ?? '', /Checking/)
  // Kept in step with the server: the clock's own exchange went out at once.
  assert.deepEqual(f.net.sent(), ['sync'])
}))

test('J5: the reading the exam came with lets answers change before the clock\'s first exchange answers', async () => {
  const net = server('practice')
  const held = []
  const reply = net.reply
  net.reply = command => command.action === 'sync' ? new Promise(resolve => held.push(() => resolve(reply(command)))) : reply(command)
  await practice(net, async f => {
    assert.equal(held.length, 1, 'the exchange is still in flight')
    assert.equal(f.screen().canAnswer, true, 'and the student can already answer')
    f.screen().onSelectOption(RIGHT)
    assert.equal(f.screen().selected, RIGHT)
  })
  // Without that timing (an attempt this page did not request, rendered elsewhere), answers wait for the exchange.
  const later = server('practice')
  const waiting = []
  const answer = later.reply
  later.reply = command => command.action === 'sync' ? new Promise(resolve => waiting.push(() => resolve(answer(command))))
    : answer(command)
  await practice(later, async f => {
    assert.equal(f.screen().canAnswer, false)
    assert.ok(f.screen().timeLeft > 0, 'the time left still shows')
    waiting.shift()()
    await f.flush()
    assert.equal(f.screen().canAnswer, true, 'the exchange landed')
  }, { received: null })
})

test('J1: Exit opens "End exam?"; nothing is handed in and the page stays', async () => practice(server('practice'), async f => {
  assert.equal(f.dialog().open, false)
  f.screen().onLeave([])
  assert.equal(f.dialog().open, true)
  assert.deepEqual(f.net.sent().filter(action => action === 'submit'), [])
  assert.deepEqual(f.navigations, [], 'Exit never leaves the exam unasked')
}))

test('J1: the back button opens "End exam?" and the exam stays on screen, on the same entry', async () => practice(server('practice'), async f => {
  assert.equal(f.history.entries.length, 2, 'one entry for the same address sits above the exam\'s own')
  assert.equal(f.history.entries[1].url, f.history.entries[0].url)
  assert.deepEqual(f.history.entries[1].state, { __NA: true, tree: 'exam', ciExamGuard: `practice-attempt:${ATTEMPT}` },
    'carrying the exam entry\'s router state')
  f.screen().onNext()
  const event = f.back()
  assert.equal(event.stopped, true, 'the app router never handles that step')
  assert.equal(f.history.index, 1, 'the guard is back on top')
  assert.equal(f.dialog().open, true, '"End exam?"')
  assert.equal(f.screen().current, 1, 'still the same question')
  // A second back (a double swipe) asks again and never leaves.
  f.back()
  assert.deepEqual([f.history.index, f.dialog().open], [1, true])
  assert.deepEqual(f.navigations, [])
  assert.deepEqual(f.net.sent().filter(action => action === 'submit'), [])
}))

test('J2: Keep going returns to the same question with the timer still running', async () => practice(server('practice'), async f => {
  f.screen().onNext()
  f.screen().onNext()
  f.screen().onLeave([])
  const before = f.screen().timeLeft
  f.dialog().onKeepGoing()
  const after = f.screen()
  assert.equal(f.dialog().open, false)
  assert.equal(after.current, 2, 'the same question')
  assert.equal(after.canAnswer, true, 'still answering')
  assert.equal(after.canExit, true)
  assert.ok(after.timeLeft <= before && after.timeLeft > 0, 'the clock never paused or restarted')
  // Back too: Keep going after the back button leaves the guard in place for the next one.
  f.back()
  f.dialog().onKeepGoing()
  assert.deepEqual([f.history.index, f.history.entries.length, f.screen().current], [1, 2, 2])
}))

test('J2: End and see results hands in once, even with a double tap, and opens the result', async () => practice(server('practice'), async f => {
  f.screen().onSelectOption(RIGHT)
  f.screen().onLeave([])
  const dialog = f.dialog()
  dialog.onEnd()
  dialog.onEnd()
  await f.flush()
  assert.deepEqual(f.net.sent().filter(action => action === 'submit'), ['submit'], 'one hand-in')
  assert.equal(f.net.grades, 1)
  assert.equal(f.graded.length, 1, 'the result screen opens once')
  assert.deepEqual(f.graded[0][0].result, { timedOut: false, score: 1, total: 3 })
  assert.equal(f.graded[0][0].sheet[Q[0]], RIGHT, 'with the answer the page held, saved or not')
  assert.equal(f.history.backs, 1, 'the guard entry is taken away, so back leaves the result as usual')
  assert.equal(f.history.index, 0)
}))

test('J2: while the hand-in is on its way "End exam?" stays up saying Submitting…, so a second tap lands on it', async () => {
  const net = server('practice')
  const held = []
  const reply = net.reply
  net.reply = command => command.action === 'submit' ? new Promise(resolve => held.push(() => resolve(reply(command))))
    : reply(command)
  await practice(net, async f => {
    f.screen().onLeave([])
    f.dialog().onEnd()
    await f.flush()
    const waiting = f.dialog()
    assert.deepEqual([waiting.open, waiting.submitting], [true, true], 'still up, both buttons waiting')
    waiting.onEnd()
    waiting.onKeepGoing()
    assert.equal(held.length, 1, 'one hand-in on its way')
    held.shift()()
    await f.flush()
    assert.equal(f.graded.length, 1, 'the result replaces the exam')
    assert.equal(net.grades, 1)
  })
})

test('J2: a hand-in whose response was lost is asked again and gives the one result', async () => practice(server('practice'), async f => {
  f.net.lose = true
  f.screen().onLeave([])
  f.dialog().onEnd()
  await f.flush()
  const failed = f.screen()
  assert.equal(f.dialog().open, false, 'the dialog closes once the hand-in did not go through')
  assert.equal(failed.saveLine.text, 'We couldn’t submit your answers. Keep this page open.')
  assert.equal(failed.canAnswer, false, 'the answers stay as they were handed in')
  assert.equal(failed.canExit, false)
  // The back button changes nothing while it is being handed in.
  f.back()
  assert.equal(f.dialog().open, false)
  await f.advance(10_000)
  assert.deepEqual(f.net.sent().filter(action => action === 'submit'), ['submit', 'submit'])
  assert.equal(f.net.grades, 1, 'graded once on the server')
  assert.equal(f.graded.length, 1)
}))

test('J6: answers made offline say "Not saved yet.", are saved when the connection is back, and are in the result', async () => practice(server('practice'), async f => {
  f.net.online = false
  f.screen().onSelectOption(RIGHT)
  f.screen().onNext()
  f.screen().onSelectOption(0)
  await f.advance(800)
  assert.equal(f.screen().saveLine.text, 'Not saved yet.')
  assert.equal(f.screen().canAnswer, true, 'the student keeps answering offline')
  // A long outage: the retries never give up.
  for (let n = 0; n < 12; n++) await f.advance(15_000)
  assert.equal(f.screen().saveLine.text, 'Not saved yet.')
  assert.ok(JSON.parse(f.records.get(`practice-unsent:${ATTEMPT}`)).dirty.length === 2, 'kept on this device meanwhile')
  f.net.online = true
  f.emit('online')
  await f.flush()
  assert.equal(f.screen().saveLine.text, 'All answers saved', 'the status recovers at once')
  assert.deepEqual(f.net.sheet, { [Q[0]]: RIGHT, [Q[1]]: 0 })
  f.screen().onLeave([])
  f.dialog().onEnd()
  await f.flush()
  assert.deepEqual(f.graded[0][0].result, { timedOut: false, score: 1, total: 3 })
  assert.deepEqual(f.graded[0][0].sheet, { [Q[0]]: RIGHT, [Q[1]]: 0 }, 'both offline answers counted, once each')
}))

test('J6: End and see results while offline sends every answer the page holds once the connection is back', async () => practice(server('practice'), async f => {
  f.screen().onSelectOption(RIGHT)
  await f.advance(800)
  assert.equal(f.screen().saveLine.text, 'All answers saved')
  f.net.online = false
  f.screen().onNext()
  f.screen().onSelectOption(RIGHT)
  f.screen().onNext()
  f.screen().onSelectOption(2)
  f.screen().onLeave([])
  f.dialog().onEnd()
  await f.flush()
  assert.equal(f.screen().saveLine.text, 'We couldn’t submit your answers. Keep this page open.')
  f.screen().onSelectOption(0)
  assert.equal(f.screen().selected, 2, 'handed in: the answers stay as they are')
  f.net.online = true
  f.emit('online')
  await f.flush()
  const submits = f.net.requests.filter(command => command.action === 'submit')
  assert.deepEqual(submits.at(-1).changes, { [Q[1]]: RIGHT, [Q[2]]: 2 }, 'the hand-in carries what was not saved yet')
  assert.deepEqual(f.graded[0][0].sheet, { [Q[0]]: RIGHT, [Q[1]]: RIGHT, [Q[2]]: 2 })
  assert.deepEqual([f.graded[0][0].result.score, f.net.grades], [2, 1], 'each answer counted once, graded once')
}))

// ---- The free-pass exam --------------------------------------------------------------------------------------------

function freePass(net, run, options, overrides = {}) {
  const load = () => ({ Component: require('./[slug]/preview/[kind]/DiscoveryExam.tsx').DiscoveryExam,
    props: { continuityToken: 'verified-student', courseSlug: 'financial-accounting-1', courseHref: '/courses/financial-accounting-1',
      deadlineAt: DEADLINE, serverNow: NOW, savedSheet: { revision: 0, answers: {} }, initialResult: null,
      questions: questions.map(({ id, prompt, options: choices, section }) => ({ item_id: id, prompt, options: choices,
        section })), ...overrides } })
  load.href = 'http://localhost/courses/financial-accounting-1/preview/cbt'
  const button = (nodes, label) => nodes.find(node => node.type === 'button' && node.props.children === label)?.props
  return mount(load, net, f => run({ ...f,
    exit: () => button(f.nodes(), 'Exit'),
    dialog: () => f.nodes().find(node => node.type?.name === 'EndExamDialog')?.props,
    choose: option => f.nodes().filter(node => node.type === 'input')[option].props.onChange(),
    next: () => button(f.nodes(), 'Next').onClick(),
    position: () => f.nodes().find(node => node.type === 'legend').props.children.join(''),
    status: () => f.nodes().find(node => node.props?.['data-save-state'] !== undefined).props.children,
    result: () => { const tree = f.render(); return tree.type?.name === 'ExamReview' ? tree.props : null } }), options)
}

test('free pass, J5: the time left shows on the first render and the line never says "Checking the time left…"', async () => freePass(server('free-pass'), async f => {
  const first = elementNodes(f.first)
  assert.ok(first.some(node => node.type === 'p' && node.props.children === '30:00'), 'the server\'s deadline at once')
  assert.ok(first.some(node => node.props?.['data-exam-open'] === ''), 'the site\'s header and footer are hidden from the first paint')
  const html = renderToStaticMarkup(f.first)
  assert.doesNotMatch(html, /Checking the time left|––:––/)
  // Every question number is a 44 px touch target: 44 px tall, in columns never narrower than 44 px.
  assert.match(html, /<ol class="grid grid-cols-\[repeat\(auto-fill,minmax\(44px,1fr\)\)\] gap-1\.5">/)
  const numbers = [...html.matchAll(/<button type="button"[^>]*aria-label="Question \d[^"]*"[^>]*class="([^"]*)"/g)]
  assert.equal(numbers.length, Q.length)
  assert.ok(numbers.every(([, classes]) => /\bh-11\b/.test(classes) && !/\bh-9\b/.test(classes)), 'all 44 px tall')
}))

test('the briefs name only a dropped connection: the timer line on the practice brief and the free pass\'s start card', async () => withTsx(() => {
  const { PRACTICE_COPY } = require('./[slug]/quiz/practice-presentation.ts')
  assert.equal(PRACTICE_COPY.timerRule, 'The timer keeps running, even if your connection drops.')
  const card = require('node:fs').readFileSync(require('node:path').join(__dirname, '[slug]/preview/[kind]/page.tsx'), 'utf8')
  assert.match(card, /\{minutes\} minutes\. \{PRACTICE_COPY\.timerRule\}/, 'the free pass says the same')
  assert.doesNotMatch(card, /keeps running if you leave|timer starts when you begin/)
}))

test('free pass, J1/J2: Exit and the back button open "End exam?"; Keep going stays on the same question', async () => freePass(server('free-pass'), async f => {
  f.next()
  assert.equal(f.position(), 'Question 2 of 3')
  f.exit().onClick()
  assert.equal(f.dialog().open, true)
  f.dialog().onKeepGoing()
  assert.equal(f.dialog().open, false)
  const event = f.back()
  assert.equal(event.stopped, true)
  assert.deepEqual([f.history.index, f.dialog().open], [1, true])
  f.dialog().onKeepGoing()
  assert.equal(f.position(), 'Question 2 of 3', 'the same question')
  assert.deepEqual(f.net.sent().filter(action => action === 'submit-exam'), [])
}))

test('free pass, J2: End and see results hands in once, even with a double tap, and shows the result', async () => freePass(server('free-pass'), async f => {
  f.choose(RIGHT)
  f.exit().onClick()
  const dialog = f.dialog()
  dialog.onEnd()
  dialog.onEnd()
  await f.flush()
  assert.deepEqual(f.net.sent().filter(action => action === 'submit-exam'), ['submit-exam'])
  assert.deepEqual(f.result().result, { score: 1, total: 3, timed_out: false })
  // A fast server answers between the two taps: the second lands on the result, which ignores taps for a moment.
  assert.equal(f.result().tapGuard, true, 'the result ignores taps at first')
  assert.match(renderToStaticMarkup(f.render()), /^<div class="grid gap-4" data-tap-guard="">/, 'over all of it')
  await new Promise(resolve => setTimeout(resolve, TAP_GUARD_MS + 50))
  assert.equal(f.result().tapGuard, false, 'then it takes taps')
  assert.doesNotMatch(renderToStaticMarkup(f.render()), /data-tap-guard/)
  const review = f.render()
  assert.equal(f.history.backs, 1, 'the guard entry is taken away under the result')
  assert.ok(elementNodes(review.type(review.props)).some(node => node.props?.href === '/courses/financial-accounting-1'),
    'Back to course under the result')
}))

test('free pass: a result shown with the page takes taps at once; only one that replaces the exam ignores them for a moment', async () =>
  freePass(server('free-pass'), async f => {
    assert.deepEqual([f.result()?.result.score, f.result()?.tapGuard], [2, false])
    assert.doesNotMatch(renderToStaticMarkup(f.first), /data-tap-guard/)
  }, undefined, { initialResult: { score: 2, total: 3, timed_out: false } }))

test('free pass, J6: answers made offline are saved when the connection is back and go with the hand-in', async () => freePass(server('free-pass'), async f => {
  f.net.online = false
  f.choose(RIGHT)
  await f.advance(800)
  assert.equal(f.status(), 'Not saved yet.')
  for (let n = 0; n < 12; n++) await f.advance(15_000)
  assert.equal(f.status(), 'Not saved yet.', 'never given up')
  f.net.online = true
  f.emit('online')
  await f.flush()
  assert.equal(f.status(), 'All answers saved.')
  f.exit().onClick()
  f.dialog().onEnd()
  await f.flush()
  assert.deepEqual([f.result().result.score, f.net.grades], [1, 1])
}))
