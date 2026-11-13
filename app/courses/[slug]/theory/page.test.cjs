const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../../../lib/test/element-walker.cjs')
const { slug, feedback, question, modelAnswer, rubric } = require('../../../../lib/theory-practice/fixtures.cjs')

async function fixture(run) {
  return withTsx(async () => {
    const original = Module._load, calls = [], client = {}
    const state = { signedOut: false, result: { status: 'ready', course: { slug, href: `/courses/${slug}`,
      code: 'INST201', title: 'Institutional theory title' }, materials: [{ question, feedbackAvailable: true, feedback: null }] } }
    function StudentAccessGate() { return null }
    // The client screen is covered in experience.test.cjs; here it shows what the server handed it.
    function TheoryPractice(props) {
      return React.createElement('div', { 'data-practice': props.courseSlug }, props.questions.map(({ question, practicable }) =>
        React.createElement('p', { key: question.itemId, 'data-question': question.itemId, 'data-practicable': String(practicable) },
          question.prompt, question.examTip ? ` Tip: ${question.examTip}` : '')))
    }
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') },
          redirect: path => { throw new Error('redirect:' + path) } }
        if (name === '@/lib/supabase/server') return { createClient: async () => { calls.push('client'); return client } }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
          assert.equal(supplied, client); calls.push('session'); return state.signedOut ? null : { user: { id: 'student' } }
        } }
        if (name === '@/lib/theory-practice/published') return { getTheoryPracticeForVerifiedStudent: async (supplied, requested) => {
          assert.equal(supplied, client); assert.equal(requested, slug); calls.push('published'); return state.result
        } }
        if (name === './TheoryPractice') return { TheoryPractice }
        return original.call(this, name, ...args)
      }
      const page = require('./page.tsx').default
      const workspace = async () => {
        const gated = await page({ params: Promise.resolve({ slug }) })
        assert.equal(gated.type, StudentAccessGate)
        assert.equal(gated.props.returnPath, `/courses/${slug}/theory`)
        const child = gated.props.children('page-token')
        return child.type(child.props)
      }
      await run({ state, calls, workspace, html: async () => renderToStaticMarkup(await workspace()),
        loading: require('./loading.tsx').default })
    } finally { Module._load = original }
  })
}

test('the initial server page sends only question prompts to clients and keeps official feedback unrevealed', async () => fixture(async f => {
  const tree = await f.workspace()
  const screens = elementNodes(tree).filter(node => node.type?.name === 'TheoryPractice')
  assert.equal(screens.length, 1)
  assert.deepEqual(Object.keys(screens[0].props).sort(), ['continuityToken', 'courseSlug', 'questions'])
  assert.deepEqual(screens[0].props.questions, [{ question, practicable: true }], 'the question and whether it can be practised: no answer')
  assert.equal(screens[0].props.courseSlug, slug)
  assert.equal(screens[0].props.continuityToken, 'page-token')
  const html = renderToStaticMarkup(tree)
  assert.ok(html.includes(question.prompt))
  assert.ok(!html.includes(modelAnswer.body) && !html.includes(rubric.body))
  assert.match(html, /INST201 · Institutional theory title/)
  assert.match(html, new RegExp(`href="/courses/${slug}"[^>]*>Back to course`))
  assert.doesNotMatch(html, /self-assessment|not verified|graded|attempt history|CampusIntell\./i)
  assert.doesNotMatch(html, /compare it with the suggested answer|Choose a question to start|student-page-band-lede/)
  assert.doesNotMatch(html, /<details|<summary|<ol|<ul|<li/, 'no list of questions')
  assert.deepEqual(f.calls, ['client', 'session', 'published'])
}))

test('the protected page is noindex and nofollow', async () => fixture(async () => {
  assert.deepEqual(require('./page.tsx').metadata.robots, { index: false, follow: false })
}))

test('every published question reaches the page in the published order, with its exam tip, practicable or not', async () => fixture(async f => {
  const second = { ...question, itemId: modelAnswer.itemId, prompt: 'Unnumbered with answer', examTip: 'State the formula first.' }
  delete second.displayNumber
  const reading = { ...question, itemId: rubric.itemId, prompt: 'Unnumbered without answer', examTip: 'Give one example.' }
  delete reading.displayNumber
  const numbered = { ...question, displayNumber: 4 }
  f.state.result.materials = [{ question: reading, feedbackAvailable: false, feedback: null }, { question: numbered, feedbackAvailable: true, feedback: null },
    { question: second, feedbackAvailable: true, feedback: null }]
  const html = await f.html()
  assert.deepEqual([...html.matchAll(/data-question="([^"]+)" data-practicable="([^"]+)"/g)].map(match => [match[1], match[2]]),
    [[reading.itemId, 'false'], [numbered.itemId, 'true'], [second.itemId, 'true']],
    'a question without a suggested answer is still shown, to be read')
  for (const shown of ['Unnumbered without answer', 'Give one example.', 'Explain management.', 'Unnumbered with answer', 'State the formula first.']) {
    assert.ok(html.includes(shown), shown)
  }
  assert.doesNotMatch(html, /More theory questions|on the course page/, 'nothing is left on the course page to point to')
}))

test('a course with no theory questions has a usable state, and one without answers still shows its questions', async () => fixture(async f => {
  f.state.result.materials = []
  const html = await f.html()
  assert.match(html, /Theory practice isn’t available for this course/)
  assert.doesNotMatch(html, /data-practice|data-question|on the course page/)
  assert.match(html, new RegExp(`href="/courses/${slug}"`))
  f.state.result.materials = [{ question, feedbackAvailable: false, feedback: null }]
  const reading = await f.html()
  assert.match(reading, new RegExp(`data-question="${question.itemId}" data-practicable="false"`))
  assert.doesNotMatch(reading, /isn’t available/)
}))

test('authentication, unknown courses and failures keep content closed without repository fallback', async () => fixture(async f => {
  f.state.signedOut = true
  await assert.rejects(f.workspace(), /redirect:.*login/)
  assert.equal(f.calls.includes('published'), false)
  f.state.signedOut = false
  for (const status of ['signed-out', 'not-found']) {
    f.state.result = { status }
    await assert.rejects(f.workspace(), status === 'not-found' ? /notFound/ : /redirect:.*login/)
  }
  for (const status of ['unavailable', 'invariant-failure']) {
    f.state.result = { status }
    const html = await f.html()
    assert.doesNotMatch(html, /INST201|Institutional theory title|Explain management|data-practice/)
    assert.match(html, /role="alert"/)
  }
}))

test('a locked course renders the unlock notice and no question, prompt or attempt field', async () => fixture(async f => {
  f.state.result = { status: 'locked', course: { slug, code: 'INST201', title: 'Institutional theory title' } }
  const html = await f.html()
  assert.match(html, /<p>INST201 · Institutional theory title<\/p>/, 'the course name, as on the ready page')
  assert.doesNotMatch(html, /Explain management|data-practice|textarea/)
  assert.match(html, /Included with full access/)
  assert.match(html, /href="\/access"/)
  assert.doesNotMatch(html, /GST/)
}))

test('loading announces once and contains no answer fields or unverified course identity', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.equal((html.match(/Loading theory practice\./g) || []).length, 1)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /<textarea|<button|INST201|Explain management/)
}))


test('theory selection recovery renders the matching single action without a plan or answers', async () => fixture(async f => {
  for (const [reason, title, action] of [
    ['needs-selection', 'Confirm your courses for this semester.', 'Confirm my courses'],
    ['selection-locked', 'Your courses are set for another semester.', 'Message us'],
  ]) {
    f.state.result = { status: 'locked', reason, course: { slug, code: 'INST201', title: 'Institutional theory title' } }
    const tree = await f.workspace()
    assert.equal(elementNodes(tree).find(node => node.type?.name === 'LockedCourseNotice').props.reason, reason)
    const html = renderToStaticMarkup(tree)
    assert.ok(html.includes(title))
    assert.ok(html.includes('>' + action + '</a>'))
    assert.equal((html.match(/<a\b/g) || []).length, 1)
    assert.doesNotMatch(html, /Included with full access|Discovery|data-practice|textarea|Explain management/)
    if (reason === 'needs-selection') assert.ok(html.includes('href="/profile-selection"'))
  }
}))

test('unavailable repository theory has the existing unavailable copy with no add or plan offer', async () => fixture(async f => {
  f.state.result = { status: 'unavailable', notAvailable: true }
  const html = await f.html()
  assert.match(html, /Study materials are not available./)
  assert.doesNotMatch(html, /Message us|Included with full access|See how to unlock|data-practice|textarea/)
  assert.ok(!html.includes('href="/access"'))
}))
