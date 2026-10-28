// User regression: blocked device storage plus an outage must never silently discard a pending choice on Exit.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../../../lib/test/element-walker.cjs')

const Q = '22222222-2222-4222-8222-222222222222'
const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date().toISOString(), DEADLINE = new Date(Date.now() + 1800_000).toISOString()
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }

async function fixture(blocked, run) {
  const original = Module._load, savedWindow = global.window, savedDocument = global.document
  let active, offline = false
  const navigations = [], requests = [], records = new Map(), timers = new Map()
  const store = { getItem: key => { if (blocked) throw Error('blocked'); return records.get(key) ?? null },
    setItem: (key, value) => { if (blocked) throw Error('full'); records.set(key, value) }, removeItem: key => records.delete(key) }
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
  global.window = { sessionStorage: store, localStorage: store, location: { assign: href => navigations.push(href) },
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id),
    setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {} }
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, ...hooks }
    if (name === '@/lib/entitlements/exam-tab') return { browserTabOptions: () => ({}),
      claimExamTabOnce: async () => ({ tab: '33333333-3333-4333-8333-333333333333', sequence: 0, remember() {} }) }
    if (name === '@/lib/practice/client') return { postPracticeCommand: async command => {
      requests.push(command)
      if (offline) return { status: 'unavailable' }
      return { status: 'saved', now: NOW, deadlineAt: DEADLINE, revision: 0, answers: {} }
    } }
    return original.call(this, name, ...args)
  }
  try {
    await withTsx(async () => {
      const { ActiveAttempt } = require('./ActiveAttempt.tsx')
      const { AssessmentConfirmation } = require('./AssessmentConfirmation.tsx')
      const props = { continuityToken: 'verified-student', courseCode: 'GST 101', courseTitle: 'Use of English',
        repositoryOnly: false, courseHref: '/courses/use-of-english', serverNow: NOW, onGraded() {},
        attempt: { id: ATTEMPT, status: 'in_progress', saved: { revision: 0, answers: {} }, deadlineAt: DEADLINE,
          questions: [{ questionId: Q, prompt: 'Choose the appropriate word.', options: ['A', 'B'], section: 'Grammar' }] } }
      const instance = { slots: [], effects: [], index: 0 }
      const render = () => {
        instance.index = 0; instance.effects = []; active = instance
        let tree
        try { tree = ActiveAttempt(props) } finally { active = null }
        for (const effect of instance.effects) effect()
        const nodes = elementNodes(tree)
        return { question: nodes.find(node => node.type?.name === 'QuestionScreen'),
          exit: nodes.find(node => node.type === AssessmentConfirmation && node.props.kind === 'exit') }
      }
      try {
        render(); await flush(); render(); await flush()
        const first = render()
        assert.equal(first.question.props.canAnswer, true, 'the student has a trusted clock before going offline')
        offline = true
        first.question.props.onSelectOption(1)
        render().question.props.onLeave([])
        const opened = render().exit
        await run({ render, opened, navigations, requests, records, AssessmentConfirmation, timers,
          reconnect: () => { offline = false }, flush })
      } finally { for (const value of instance.slots) value?.cleanup?.() }
    })
  } finally {
    Module._load = original
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument
  }
}

test('blocked storage and an outage require Stay or Leave anyway before losing a pending answer', async () => fixture(true, async f => {
  assert.equal(f.opened.props.open, true)
  assert.match(f.opened.props.body, /Some answers aren’t saved yet\. If you leave now, they’ll be lost\./)
  assert.deepEqual(f.navigations, [], 'opening Exit never leaves the attempt')
  const buttons = elementNodes(f.AssessmentConfirmation(f.opened.props)).filter(node =>
    typeof node.props?.children === 'string').map(node => node.props.children)
  assert.ok(buttons.includes('Stay'))
  assert.ok(buttons.includes('Leave anyway'))
  f.opened.props.onOpenChange(false) // Stay: the choice is still on the question screen.
  assert.equal(f.render().question.props.selected, 1)
  f.render().question.props.onLeave([])
  f.render().exit.props.onConfirm() // Explicit Leave anyway.
  await f.flush()
  assert.equal(f.navigations.length, 1)
  assert.ok(f.requests.some(command => command.action === 'save'), 'leaving still tries to flush')
}))

test('a pending answer stored on the device can Exit without the loss warning while offline', async () => fixture(false, async f => {
  assert.doesNotMatch(f.opened.props.body, /they’ll be lost/)
  const stored = JSON.parse(f.records.get(`practice-unsent:${ATTEMPT}`))
  assert.equal(stored.answers[Q], 1)
  f.opened.props.onConfirm()
  assert.equal(f.navigations.length, 1)
}))
