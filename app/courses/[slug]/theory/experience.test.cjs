const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../../../lib/test/element-walker.cjs')
const { feedback, question, slug, command, longDraft } = require('../../../../lib/theory-practice/fixtures.cjs')

// Exercise real event handlers with deterministic hooks; browser checks cover native focus/validation/layout.
async function fixture(run, { realClient = false } = {}) {
  return withTsx(async () => {
    const original = Module._load, events = [], requests = [], focuses = []
    let active, index, ids = 0, response = { status: 'ready', feedback }
    const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
    const hooks = {
      ...React,
      useState(initial) {
        const instance = active, slot = index++
        if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial
        return [instance.slots[slot], value => { instance.slots[slot] = typeof value === 'function' ? value(instance.slots[slot]) : value }]
      },
      useRef(initial) {
        const slot = index++
        if (!(slot in active.slots)) active.slots[slot] = { current: initial }
        return active.slots[slot]
      },
      useId() {
        const slot = index++
        if (!(slot in active.slots)) active.slots[slot] = `theory-test-${++ids}`
        return active.slots[slot]
      },
      useEffect(effect, deps) {
        const slot = index++, previous = active.slots[slot]
        if (!previous || !depsEqual(previous.deps, deps)) {
          const instance = active
          instance.effects.push(() => { previous?.cleanup?.(); instance.slots[slot] = { deps, cleanup: effect() } })
        }
      },
    }
    try {
      Module._load = function(name, ...args) {
        if (name === 'react') return hooks
        if (name === '@vercel/analytics') return { track: (...args) => events.push(args) }
        if (name === '@/lib/theory-practice/client' && !realClient) return { revealTheoryAnswer: async (...args) => { requests.push(args); return response } }
        return original.call(this, name, ...args)
      }
      const { TheoryAttempt } = require('./TheoryAttempt.tsx')
      const { SelfAssessment } = require('./SelfAssessment.tsx')
      const mount = (Component, props) => {
        const instance = { slots: [], effects: [], props, render() {
          active = instance; index = 0; instance.effects = []
          let tree
          try { tree = Component(instance.props) } finally { active = null }
          for (const node of elementNodes(tree)) if (node.props.ref && typeof node.props.ref === 'object') {
            node.props.ref.current = { focus: () => focuses.push(node.type), closest: () => ({ open: true }) }
          }
          instance.effects.forEach(effect => effect())
          return tree
        } }
        return instance
      }
      await run({ mount, TheoryAttempt, SelfAssessment, requests, events, focuses,
        respond: value => { response = value }, nodes: elementNodes })
    } finally { Module._load = original }
  })
}
const submit = tree => elementNodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })

test('blank answers submit immediately, freeze while loading and reveal feedback without automatic scoring', async () => fixture(async f => {
  const attempt = f.mount(f.TheoryAttempt, { question, courseSlug: slug, continuityToken: 'page-token' })
  const initial = attempt.render()
  const field = f.nodes(initial).find(node => node.type === 'textarea')
  assert.equal(field.props.required, undefined)
  assert.equal(field.props.minLength, undefined)
  assert.equal(field.props.maxLength, 20000)
  assert.doesNotMatch(renderToStaticMarkup(initial), /Official model answer|Authored rubric/)
  const pending = submit(initial)
  const busy = attempt.render()
  assert.equal(f.nodes(busy).find(node => node.type === 'textarea').props.disabled, true)
  await pending
  const assessment = f.nodes(attempt.render()).find(node => node.type === f.SelfAssessment)
  assert.equal(assessment.props.answer, '')
  assert.deepEqual(assessment.props.feedback, feedback)
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.requests[0][0], command(), 'only the question identity is requested')
  assert.equal(f.requests[0][1], 'page-token')
}))

test('a typed 20,000-character draft never reaches the network yet is shown back for comparison', async () => fixture(async f => {
  const original = globalThis.fetch, sent = []
  globalThis.fetch = async (url, options) => { sent.push({ url, options }); return Response.json({ status: 'ready', feedback }) }
  try {
    const attempt = f.mount(f.TheoryAttempt, { question, courseSlug: slug, continuityToken: 'page-token' })
    const draft = longDraft()
    f.nodes(attempt.render()).find(node => node.type === 'textarea').props.onChange({ currentTarget: { value: draft } })
    await submit(attempt.render())
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, '/api/theory-practice')
    assert.deepEqual(JSON.parse(sent[0].options.body), command())
    assert.doesNotMatch(JSON.stringify([sent[0].url, sent[0].options.headers, sent[0].options.body]), /STUDENT-DRAFT-MARKER|x{100}/)
    const assessment = f.nodes(attempt.render()).find(node => node.type === f.SelfAssessment)
    assert.equal(assessment.props.answer, draft, 'the draft stays in page state for the comparison')
  } finally { globalThis.fetch = original }
}, { realClient: true }))

test('failed submissions preserve the typed draft and a second click cannot race the first', async () => fixture(async f => {
  f.respond({ status: 'content-changed' })
  const attempt = f.mount(f.TheoryAttempt, { question, courseSlug: slug, continuityToken: 'page-token' })
  f.nodes(attempt.render()).find(node => node.type === 'textarea').props.onChange({ currentTarget: { value: 'My own answer' } })
  const tree = attempt.render()
  await Promise.all([submit(tree), submit(tree)])
  const refused = attempt.render()
  assert.equal(f.nodes(refused).find(node => node.type === 'textarea').props.value, 'My own answer')
  assert.match(renderToStaticMarkup(refused), /copy it, then refresh/)
  assert.equal(f.requests.length, 1)
  assert.equal(f.nodes(refused).some(node => node.type === f.SelfAssessment), false)
}))

test('each authored point needs a student decision; completion counts coverage and records no answer or reflection', async () => fixture(async f => {
  const assessment = f.mount(f.SelfAssessment, { feedback, answer: 'My own answer', courseSlug: slug, onRetry() {} })
  const initial = assessment.render()
  assert.equal(f.focuses.at(-1), 'h2')
  assert.equal(f.nodes(initial).filter(node => node.type === 'select').length, 2)
  await submit(initial)
  assert.deepEqual(f.events, [])
  f.nodes(initial).filter(node => node.type === 'select')[0].props.onChange({ currentTarget: { value: 'covered' } })
  f.nodes(assessment.render()).filter(node => node.type === 'select')[1].props.onChange({ currentTarget: { value: 'partly' } })
  await submit(assessment.render())
  const completed = renderToStaticMarkup(assessment.render())
  assert.match(completed, /Self-assessment complete/)
  assert.match(completed, /1 covered · 1 partly covered · 0 to revisit/)
  assert.match(completed, /not verified or AI graded/)
  assert.match(completed, /do not calculate the rubric’s marks/)
  assert.deepEqual(f.events, [['theory_self_assessment_completed', { course_slug: slug, has_rubric: true,
    covered_points: 1, partly_covered_points: 1, revisit_points: 0 }]])
  await submit(assessment.render())
  assert.equal(f.events.length, 1)
  let prevented = false
  const edit = f.nodes(assessment.render()).find(node => node.type === 'button' && node.props.children === 'Edit self-assessment')
  edit.props.onClick({ preventDefault() { prevented = true } })
  const editable = assessment.render()
  assert.equal(prevented, true)
  assert.match(renderToStaticMarkup(editable), /Finish self-assessment/)
  assert.equal(f.nodes(editable).filter(node => node.type === 'select')[0].props.value, 'covered')
  await submit(editable)
  assert.equal(f.events.length, 1, 'editing the same assessment does not double-count completion')
}))

test('model-answer-only practice has no marking checklist or fabricated score and can finish with an empty answer', async () => fixture(async f => {
  const assessment = f.mount(f.SelfAssessment, { feedback: { ...feedback, rubric: null }, answer: '', courseSlug: slug, onRetry() {} })
  const tree = assessment.render()
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Official model answer/)
  assert.match(html, /No authored rubric is published/)
  assert.match(html, /You submitted an empty answer/)
  assert.doesNotMatch(html, /<select|Your self-score for point|points assessed/)
  await submit(tree)
  assert.match(renderToStaticMarkup(assessment.render()), /Self-assessment complete/)
  assert.equal(f.events[0][1].has_rubric, false)
}))
