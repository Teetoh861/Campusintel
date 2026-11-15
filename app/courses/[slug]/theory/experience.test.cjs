const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../../../lib/test/element-walker.cjs')
const { feedback, question, slug, command, longDraft, answerId, rubricId } = require('../../../../lib/theory-practice/fixtures.cjs')

// Exercise real event handlers with deterministic hooks; browser checks cover native focus/validation/layout.
async function fixture(run, { realClient = false } = {}) {
  return withTsx(async () => {
    const original = Module._load, events = [], requests = [], focuses = []
    let active, index, ids = 0, response = { status: 'ready', feedback }, search = ''
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
        // The address of the page: its ?question= names the question on screen.
        if (name === 'next/navigation') return { useSearchParams: () => new URLSearchParams(search) }
        if (name === '@/lib/theory-practice/client' && !realClient) return { revealTheoryAnswer: async (...args) => { requests.push(args); return response } }
        return original.call(this, name, ...args)
      }
      const { TheoryAttempt } = require('./TheoryAttempt.tsx')
      const { SelfAssessment } = require('./SelfAssessment.tsx')
      const { TheoryPractice } = require('./TheoryPractice.tsx')
      const mount = (Component, props) => {
        const instance = { slots: [], effects: [], props, render() {
          active = instance; index = 0; instance.effects = []
          let tree
          try { tree = Component(instance.props) } finally { active = null }
          for (const node of elementNodes(tree)) if (node.props.ref && typeof node.props.ref === 'object') {
            // On screen: no hidden question holds it.
            node.props.ref.current = { focus: () => focuses.push(node.type), closest: () => null }
          }
          instance.effects.forEach(effect => effect())
          return tree
        } }
        return instance
      }
      await run({ mount, TheoryAttempt, SelfAssessment, TheoryPractice, requests, events, focuses,
        respond: value => { response = value }, address: value => { search = value }, nodes: elementNodes })
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
  assert.doesNotMatch(renderToStaticMarkup(initial), /Suggested answer|Marking guide/)
  assert.match(renderToStaticMarkup(initial), /<button[^>]*>Show answer<\/button>/)
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
  assert.match(renderToStaticMarkup(refused), /This question has changed\. Copy your answer before you reload\./)
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
  assert.match(completed, /Review complete/)
  assert.match(completed, /1 got it · 1 partly · 0 not yet · 2 of 2 points rated/)
  assert.match(completed, /How did you do\?/)
  assert.match(completed, />Key points</)
  assert.doesNotMatch(completed, /Marking guide|Rate how well/)
  assert.match(completed, /<option value="covered"[^>]*>Got it<\/option><option value="partly"[^>]*>Partly<\/option><option value="not-yet"[^>]*>Not yet<\/option>/)
  assert.doesNotMatch(completed, /self-assess|not verified|graded|calculate a mark/i)
  assert.deepEqual(f.events, [['theory_self_assessment_completed', { course_slug: slug, has_rubric: true,
    covered_points: 1, partly_covered_points: 1, revisit_points: 0 }]])
  await submit(assessment.render())
  assert.equal(f.events.length, 1)
  let prevented = false
  const edit = f.nodes(assessment.render()).find(node => node.type === 'button' && node.props.children === 'Edit ratings')
  edit.props.onClick({ preventDefault() { prevented = true } })
  const editable = assessment.render()
  assert.equal(prevented, true)
  assert.match(renderToStaticMarkup(editable), /Finish review/)
  assert.equal(f.nodes(editable).filter(node => node.type === 'select')[0].props.value, 'covered')
  await submit(editable)
  assert.equal(f.events.length, 1, 'editing the same assessment does not double-count completion')
}))

test('model-answer-only practice has no marking checklist or fabricated score and can finish with an empty answer', async () => fixture(async f => {
  const assessment = f.mount(f.SelfAssessment, { feedback: { ...feedback, rubric: null }, answer: '', courseSlug: slug, onRetry() {} })
  const tree = assessment.render()
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Suggested answer/)
  assert.match(html, /Check your answer/)
  assert.doesNotMatch(html, /Key points|note what you would improve|Rate how well/)
  assert.match(html, /You submitted an empty answer/)
  assert.doesNotMatch(html, /<select|How did you do|points rated/)
  await submit(tree)
  assert.match(renderToStaticMarkup(assessment.render()), /Review complete/)
  assert.equal(f.events[0][1].has_rubric, false)
}))

// Theory practice, one question at a time. Typing and the reveal run in a real browser check; these cover what shows.
const steps = [{ question: { ...question, examTip: 'Define it first.' }, practicable: true },
  { question: { itemId: answerId, publishedRevision: 1, prompt: 'Read-only question', examTip: 'Give one example.' }, practicable: false },
  { question: { itemId: rubricId, publishedRevision: 5, prompt: 'Third question' }, practicable: true }]
// The words on screen, without rendering the answer boxes (each is its own component, covered above).
const words = node => Array.isArray(node) ? node.map(words).join(' ') : node === null || node === undefined || node === false ? ''
  : typeof node === 'object' ? (typeof node.type === 'string' ? words(node.props.children) : '') : String(node)
const text = tree => words(tree).replace(/\s+/g, ' ').trim()

/** The screen as a student sees it: which question shows, and the two steps. */
function screen(f, tree) {
  const panels = f.nodes(tree).filter(node => node.type === 'div' && 'hidden' in node.props)
  const shown = panels.filter(panel => !panel.props.hidden)
  const button = label => f.nodes(tree).find(node => node.type === 'button' && node.props.children === label)
  return { panels, shown, previous: button('Previous'), next: button('Next') }
}

test('one question shows at a time, with its place, its exam tip and its answer box; Previous and Next move between them', async () => fixture(async f => {
  const replaced = [], window = globalThis.window, frame = globalThis.requestAnimationFrame
  globalThis.window = { history: { replaceState: (...args) => replaced.push(args) } }
  globalThis.requestAnimationFrame = callback => callback()
  try {
    const practice = f.mount(f.TheoryPractice, { questions: steps, courseSlug: slug, continuityToken: 'page-token' })
    let view = screen(f, practice.render())
    assert.equal(view.panels.length, 3, 'every question stays mounted, so its draft and its revealed answer are kept')
    assert.equal(view.shown.length, 1)
    assert.equal(text(view.shown[0]), 'Question 1 of 3 Explain management. Exam tip: Define it first.')
    assert.equal(view.previous.props.disabled, true)
    assert.equal(view.next.props.disabled, false)
    // Each question that can be practised keeps its own answer box; a question with no suggested answer is read only.
    const attempts = view.panels.map(panel => f.nodes(panel).filter(node => node.type === f.TheoryAttempt))
    assert.deepEqual(attempts.map(found => found.length), [1, 0, 1])
    assert.deepEqual(attempts[0][0].props, { question: steps[0].question, courseSlug: slug, continuityToken: 'page-token' })
    const kept = attempts[0][0]

    view.next.props.onClick()
    view = screen(f, practice.render())
    assert.equal(text(view.shown[0]), 'Question 2 of 3 Read-only question Exam tip: Give one example.')
    assert.deepEqual(replaced.at(-1), [null, '', `/courses/${slug}/theory?question=${answerId}`], 'the address follows the question')
    assert.equal(f.focuses.at(-1), 'h2', 'the question\'s place takes focus')
    assert.equal(view.previous.props.disabled, false)

    view.next.props.onClick()
    view = screen(f, practice.render())
    assert.equal(text(view.shown[0]), 'Question 3 of 3 Third question')
    assert.equal(view.next.props.disabled, true, 'nothing after the last question')

    view.previous.props.onClick()
    view.previous = screen(f, practice.render()).previous
    view.previous.props.onClick()
    view = screen(f, practice.render())
    assert.equal(text(view.shown[0]), 'Question 1 of 3 Explain management. Exam tip: Define it first.')
    const again = f.nodes(view.panels[0]).find(node => node.type === f.TheoryAttempt)
    assert.equal(again.key, kept.key, 'the same answer box as before, not a new one')
    assert.deepEqual(replaced.map(call => call[2]), [answerId, rubricId, answerId, question.itemId]
      .map(id => `/courses/${slug}/theory?question=${id}`))
    assert.deepEqual(f.nodes(practice.render()).filter(node => ['ol', 'ul', 'li', 'details', 'summary'].includes(node.type)), [],
      'no list of questions')
  } finally { globalThis.window = window; globalThis.requestAnimationFrame = frame }
}))

test('a question a study guide links to opens first; any other address opens the first question', async () => fixture(async f => {
  f.address(`question=${rubricId}`)
  const linked = screen(f, f.mount(f.TheoryPractice, { questions: steps, courseSlug: slug, continuityToken: 'page-token' }).render())
  assert.equal(text(linked.shown[0]), 'Question 3 of 3 Third question')
  for (const other of ['', 'question=not-a-question', 'topic=1']) {
    f.address(other)
    const first = screen(f, f.mount(f.TheoryPractice, { questions: steps, courseSlug: slug, continuityToken: 'page-token' }).render())
    assert.equal(text(first.shown[0]), 'Question 1 of 3 Explain management. Exam tip: Define it first.', other)
  }
}))

test('a single question has no Previous or Next', async () => fixture(async f => {
  const view = screen(f, f.mount(f.TheoryPractice, { questions: steps.slice(0, 1), courseSlug: slug, continuityToken: 'page-token' }).render())
  assert.equal(text(view.shown[0]), 'Question 1 of 1 Explain management. Exam tip: Define it first.')
  assert.equal(view.previous, undefined)
  assert.equal(view.next, undefined)
}))

test('a refusal\'s way on comes back to the same question', async () => fixture(async f => {
  for (const [status, href] of [
    ['signed-out', `/login?next=${encodeURIComponent(`/courses/${slug}/theory?question=${question.itemId}`)}`],
    ['session-changed', `/courses/${slug}/theory?question=${question.itemId}`],
    ['content-changed', `/courses/${slug}/theory?question=${question.itemId}`]]) {
    f.respond({ status })
    const attempt = f.mount(f.TheoryAttempt, { question, courseSlug: slug, continuityToken: 'page-token' })
    await submit(attempt.render())
    const link = f.nodes(attempt.render()).find(node => node.type === 'a')
    assert.equal(link.props.href, href, status)
  }
  const { getSafeReturnPath } = require('../../../../lib/auth/redirect.ts')
  const page = `/courses/${slug}/theory?question=${question.itemId}`
  assert.equal(getSafeReturnPath(page), page, 'sign-in keeps the question')
}))
