// app/courses/[slug]/quiz/instant-feedback.test.cjs — Instant feedback in the browser: a pick locks at once and shows
// right or wrong (icon and words, never colour alone) only when the server answers; "Why" only with an explanation;
// Next waits for the result; haptics only for a result the server returned after a tap, on a visible page; a pick with
// no answer is kept and sent again on reconnect or reload; the start offers two choices; the end says "7 of 10 right".
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-29T09:00:00.000Z'
const Q = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const identity = { courseCode: 'GST 112', courseTitle: 'Use of English', repositoryOnly: false }
// Correct option is 1 for every question; question 0 has an explanation, the others none.
const feedbackFor = (n, selected) => ({ selected, correctOption: 1, explanation: n === 0 ? 'Because it agrees.' : null })
const openAttempt = (picked = {}, count = 3) => ({ status: 'in_progress', id: ATTEMPT, courseId: 'course-1', mode: 'instant',
  intent: 'new', redoOf: null, startedAt: NOW, deadlineAt: NOW, durationSeconds: 10800, questionCount: count, bankSize: 100,
  saved: { revision: 0, answers: {} }, questions: Array.from({ length: count }, (_, n) => ({ questionId: Q(n),
    prompt: `Prompt ${n}`, options: ['A', 'B', 'C'], section: 'General',
    ...(n in picked ? { feedback: feedbackFor(n, picked[n]) } : {}) })) })
const gradedAttempt = (score, selections) => ({ ...openAttempt(), status: 'submitted',
  result: { score, total: selections.length, timedOut: false, finishedAt: NOW },
  questions: selections.map((selected, n) => ({ questionId: Q(n), prompt: `Prompt ${n}`, options: ['A', 'B', 'C'],
    section: 'General', itemId: Q(50 + n), revision: 1, selected, correctOption: 1, explanation: null })) })
const picked = (n, selected, attempt) => ({ status: 'picked', now: NOW, attempt,
  pick: { questionId: Q(n), selected, correctOption: 1, isCorrect: selected === 1, explanation: n === 0 ? 'Because it agrees.' : null } })

test('marks, resume point, end line and haptic rules', async () => withTsx(async () => {
  const { optionMarkOf, firstOpenQuestion, instantScoreLine, vibrateForResult, hapticPattern } = require('./instant-feedback.ts')
  const right = { selected: 1, correctOption: 1, explanation: null }
  const wrong = { selected: 2, correctOption: 1, explanation: null }
  assert.deepEqual([0, 1, 2].map(n => optionMarkOf(n, right)), [null, { mark: 'correct', label: 'Correct' }, null])
  assert.deepEqual([0, 1, 2].map(n => optionMarkOf(n, wrong)),
    [null, { mark: 'correct', label: 'Correct answer' }, { mark: 'incorrect', label: 'Your answer' }])
  assert.equal(optionMarkOf(1, undefined), null, 'nothing is marked before the server answers')
  assert.equal(firstOpenQuestion([{ feedback: right }, { feedback: wrong }, {}]), 2, 'resume on the next unanswered question')
  assert.equal(firstOpenQuestion([{ feedback: right }]), 0)
  assert.equal(instantScoreLine(7, 10), '7 of 10 right')
  assert.deepEqual([hapticPattern(true), hapticPattern(false)], [10, [10, 60, 10]])
  const calls = []
  const vibrate = pattern => { calls.push(pattern); return true }
  assert.equal(vibrateForResult(true, { vibrate, visible: true, tapped: true }), true)
  assert.equal(vibrateForResult(false, { vibrate, visible: true, tapped: true }), true)
  assert.equal(vibrateForResult(true, { vibrate, visible: false, tapped: true }), false, 'never while the page is hidden')
  assert.equal(vibrateForResult(true, { vibrate, visible: true, tapped: false }), false, 'only after a tap on this page')
  assert.equal(vibrateForResult(true, { visible: true, tapped: true }), false, 'no vibrate API (iOS): nothing')
  assert.deepEqual(calls, [10, [10, 60, 10]])
}))

/** InstantAttempt with controlled hooks, a scripted server, session storage and a vibrate spy. */
async function flow(run, records = new Map()) {
  const load = Module._load
  const saved = { window: global.window, document: global.document, requestAnimationFrame: global.requestAnimationFrame }
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator')
  const answers = [], requests = [], vibrations = [], listeners = new Map(), graded = []
  const store = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key) }
  const instance = { slots: [], effects: [], index: 0 }
  let active = null
  const hooks = {
    useState(initialValue) {
      const owner = active, n = owner.index++
      if (!(n in owner.slots)) owner.slots[n] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [owner.slots[n], value => { owner.slots[n] = typeof value === 'function' ? value(owner.slots[n]) : value }]
    },
    useRef(value) { const n = active.index++; return active.slots[n] ??= { current: value } },
    useId() { active.index++; return 'id' },
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
  global.window = { sessionStorage: store, localStorage: store,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  global.document = { visibilityState: 'visible' }
  global.requestAnimationFrame = fn => fn()
  Object.defineProperty(global, 'navigator', { configurable: true, value: { vibrate: pattern => { vibrations.push(pattern); return true } } })
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, ...hooks }
    if (name === 'next/link') return { __esModule: true, default: ({ href, className, children }) =>
      React.createElement('a', { href, className }, children) }
    if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => () => React.createElement('svg', { 'data-icon': icon }) })
    if (name === '@/lib/practice/client') return { postPracticeCommand: async command => {
      requests.push(command)
      const next = answers.shift()
      assert.ok(next, `no scripted answer for ${command.action}`)
      return next
    } }
    return load.call(this, name, ...args)
  }
  try {
    await withTsx(async () => {
      delete require.cache[require.resolve('./InstantAttempt.tsx')]
      const { InstantAttempt } = require('./InstantAttempt.tsx')
      const mount = attempt => {
        instance.slots = []
        const render = () => {
          instance.index = 0; instance.effects = []; active = instance
          let tree
          try { tree = InstantAttempt({ ...identity, continuityToken: 'token', courseHref: '/courses/use-of-english',
            attempt, onGraded: result => graded.push(result) }) } finally { active = null }
          for (const effect of instance.effects) effect()
          return tree
        }
        return render
      }
      const settle = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)) }
      const html = tree => renderToStaticMarkup(tree)
      // The radio of option n on the question shown.
      const choose = (tree, n) => {
        const options = find(tree, element => element.type === 'input' && element.props.type === 'radio')
        options[n].props.onChange()
      }
      const nextButton = tree => find(tree, element => element.type === 'button' && /Next|See result/.test(text(html(element))))[0]
      await run({ mount, settle, html, choose, nextButton, answers, requests, vibrations, listeners, graded, records })
    })
  } finally {
    Module._load = load
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete global[key]; else global[key] = value
    }
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor); else delete global.navigator
  }
}

function find(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) { for (const child of node) find(child, predicate, found); return found }
  if (predicate(node)) found.push(node)
  find(node.props?.children, predicate, found)
  return found
}

test('a right pick: locked at once, marked only when the server answers, one haptic; Why with an explanation', async () => flow(async f => {
  const render = f.mount(openAttempt())
  let tree = render()
  assert.match(text(f.html(tree)), /^Exit 1 of 3 /, 'the bar holds Exit and the position, nothing else')
  assert.equal(f.nextButton(tree).props.disabled, true, 'Next waits for a result')
  assert.doesNotMatch(f.html(tree), /Correct|Why/)
  f.answers.push(picked(0, 1, openAttempt({ 0: 1 })))
  f.choose(tree, 1)
  tree = render()
  assert.match(text(f.html(tree)), /Locked/, 'the pick shows as locked before any result')
  assert.match(text(f.html(tree)), /Checking your answer/)
  assert.doesNotMatch(text(f.html(tree)), /Correct/, 'no result before the server answers')
  assert.deepEqual(f.requests[0], { action: 'pick', attemptId: ATTEMPT, questionId: Q(0), option: 1 })
  await f.settle()
  tree = render()
  const out = f.html(tree)
  assert.match(out, /data-mark="correct"[\s\S]*?data-icon="CircleCheck"[\s\S]*?Correct</, 'icon and word on the pick')
  assert.doesNotMatch(out, /Your answer|Correct answer|data-mark="incorrect"/)
  assert.match(text(out), /Why Because it agrees\./)
  assert.deepEqual(f.vibrations, [10], 'right: one 10 ms pulse, once the server answered')
  assert.equal(f.nextButton(tree).props.disabled, false)
  assert.equal(f.records.size, 0, 'nothing is kept once the server has answered')
}))

test('a wrong pick marks "Your answer" and "Correct answer"; no Why without an explanation; two pulses', async () => flow(async f => {
  const render = f.mount(openAttempt({ 0: 1 }))
  let tree = render()
  assert.match(text(f.html(tree)), /2 of 3/, 'resumes on the next unanswered question')
  f.answers.push(picked(1, 2, openAttempt({ 0: 1, 1: 2 })))
  f.choose(tree, 2)
  await f.settle()
  tree = render()
  const out = f.html(tree)
  assert.match(out, /data-mark="incorrect"[\s\S]*?data-icon="CircleX"[\s\S]*?Your answer</)
  assert.match(out, /data-mark="correct"[\s\S]*?data-icon="CircleCheck"[\s\S]*?Correct answer</)
  assert.doesNotMatch(text(out), /Why/, 'nothing appears when the question has no explanation')
  assert.deepEqual(f.vibrations, [[10, 60, 10]])
}))

test('offline: the pick is kept, sent again on reconnect and after a reload, and a reload never vibrates', async () => {
  const records = new Map()
  await flow(async f => {
    const render = f.mount(openAttempt())
    let tree = render()
    f.answers.push({ status: 'unavailable' })
    f.choose(tree, 0)
    await f.settle()
    tree = render()
    assert.match(text(f.html(tree)), /No connection\. Your answer is kept/)
    assert.match(text(f.html(tree)), /Locked/)
    assert.equal(f.nextButton(tree).props.disabled, true)
    assert.equal(f.records.size, 1, 'kept on this device')
    // Reconnected: the same pick goes again.
    f.answers.push({ status: 'unavailable' })
    f.listeners.get('online')()
    await f.settle()
    assert.deepEqual(f.requests.map(request => [request.questionId, request.option]), [[Q(0), 0], [Q(0), 0]])
  }, records)
  await flow(async f => {
    // A reload in the same tab: the kept pick is sent again before anything else.
    f.answers.push(picked(0, 0, openAttempt({ 0: 0 })))
    const render = f.mount(openAttempt())
    render()
    await f.settle()
    const tree = render()
    assert.deepEqual(f.requests, [{ action: 'pick', attemptId: ATTEMPT, questionId: Q(0), option: 0 }])
    assert.match(f.html(tree), /Your answer/)
    assert.deepEqual(f.vibrations, [], 'no tap on this page yet: no haptic')
    assert.equal(f.records.size, 0)
  }, records)
})

test('signed out: the pick is kept; a different pick after the lock shows the original result', async () => flow(async f => {
  const render = f.mount(openAttempt())
  let tree = render()
  f.answers.push({ status: 'signed-out' })
  f.choose(tree, 2)
  await f.settle()
  tree = render()
  assert.match(text(f.html(tree)), /signed out[\s\S]*Your answer is kept/)
  assert.equal(f.records.size, 1)
  // Another tab had already recorded option 1: the server refuses this one and returns the original.
  f.answers.push({ ...picked(0, 1, openAttempt({ 0: 1 })), status: 'answer-locked' })
  f.listeners.get('online')()
  await f.settle()
  tree = render()
  assert.match(f.html(tree), /data-mark="correct"[\s\S]*?Correct</)
  assert.doesNotMatch(f.html(tree), /Your answer/)
  assert.deepEqual(f.vibrations, [], 'a refused pick does not vibrate')
}))

test('the last pick ends the attempt; See result shows it', async () => flow(async f => {
  const render = f.mount(openAttempt({ 0: 1, 1: 1 }))
  let tree = render()
  assert.match(text(f.html(tree)), /3 of 3/)
  f.answers.push(picked(2, 0, gradedAttempt(2, [1, 1, 0])))
  f.choose(tree, 0)
  await f.settle()
  tree = render()
  const next = f.nextButton(tree)
  assert.equal(text(f.html(next)), 'See result')
  next.props.onClick()
  assert.equal(f.graded.length, 1)
  assert.equal(f.graded[0].result.score, 2)
}))

test('the start offers two choices; the end says how many were right and offers two actions', async () => withTsx(async () => {
  const { ModeChoiceScreen } = require('./ModeChoiceScreen.tsx')
  const { InstantResult } = require('./InstantResult.tsx')
  const start = renderToStaticMarkup(React.createElement(ModeChoiceScreen, { ...identity, courseHref: '/courses/use-of-english',
    starting: false, error: null, lastResultHref: null, onInstant() {}, onExam() {}, onRetry() {} }))
  assert.match(text(start), /Instant feedback See each answer as you go\. .*Exam mode Timed, results at the end\./)
  assert.equal((start.match(/<button/g) ?? []).length, 2)
  const end = renderToStaticMarkup(React.createElement(InstantResult, { ...identity, courseHref: '/courses/use-of-english',
    attempt: gradedAttempt(7, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0]), canStartNew: true, starting: false, error: null,
    onPractiseAgain() {}, onRetry() {} }))
  assert.match(end, /<h1[^>]*>7 of 10 right<\/h1>/)
  assert.match(text(end), /Practise again Back to course$/)
  assert.doesNotMatch(text(end), /You answered/, 'a finished attempt needs no second line')
  const early = renderToStaticMarkup(React.createElement(InstantResult, { ...identity, courseHref: '/courses/use-of-english',
    attempt: gradedAttempt(2, [1, 1, 0, null, null]), canStartNew: false, starting: false, error: null,
    onPractiseAgain() {}, onRetry() {} }))
  assert.match(early, /<h1[^>]*>2 of 3 right<\/h1>/, 'correct out of answered')
  assert.doesNotMatch(early, /Practise again/, 'no new attempt without access')
}))
