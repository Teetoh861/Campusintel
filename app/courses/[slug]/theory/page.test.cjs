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
      code: 'INST201', title: 'Institutional theory title' }, materials: [{ question, feedback }] } }
    function StudentAccessGate() { return null }
    function TheoryAttempt(props) { return React.createElement('div', { 'data-attempt-id': props.question.itemId }) }
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
        if (name === './TheoryAttempt') return { TheoryAttempt }
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
  const attempts = elementNodes(tree).filter(node => node.type?.name === 'TheoryAttempt')
  assert.equal(attempts.length, 1)
  assert.deepEqual(Object.keys(attempts[0].props).sort(), ['continuityToken', 'courseSlug', 'question'])
  assert.deepEqual(attempts[0].props.question, question)
  const html = renderToStaticMarkup(tree)
  assert.ok(html.includes(question.prompt))
  assert.ok(!html.includes(modelAnswer.body) && !html.includes(rubric.body))
  assert.match(html, /INST201 · Institutional theory title/)
  assert.match(html, /Student self-assessment/)
  assert.match(html, /not verified or AI graded/)
  assert.match(html, /written answers and reflections stay on this page only\. They are never sent to CampusIntell and are not saved to attempt history/)
  assert.match(html, /<details[^>]*name="theory-practice"[^>]*open=""/)
  assert.deepEqual(f.calls, ['client', 'session', 'published'])
}))

test('the protected page is noindex and nofollow', async () => fixture(async () => {
  assert.deepEqual(require('./page.tsx').metadata.robots, { index: false, follow: false })
}))

test('question labels match Course Detail, including questions without a published model answer', async () => fixture(async f => {
  const { theoryDisplayNumbers } = require('../../../../lib/theory-practice/numbering.ts')
  const second = { ...question, itemId: modelAnswer.itemId, prompt: 'Unnumbered with answer' }
  delete second.displayNumber
  const reading = { ...question, itemId: rubric.itemId, prompt: 'Unnumbered without answer' }
  delete reading.displayNumber
  const numbered = { ...question, displayNumber: 4 }
  f.state.result.materials = [{ question: reading, feedback: null }, { question: numbered, feedback },
    { question: second, feedback: { ...feedback, question: second } }]
  const html = await f.html()
  assert.deepEqual(theoryDisplayNumbers([reading, numbered, second]), [5, 4, 6])
  assert.match(html, /Q4 · Explain management\./)
  assert.match(html, /Q6 · Unnumbered with answer/)
  assert.doesNotMatch(html, /Q5 ·|Unnumbered without answer/, 'reading-only questions keep their number but are not practised')
}))

test('missing model answers never launch practice and empty courses have a usable state', async () => fixture(async f => {
  f.state.result.materials = [{ question, feedback: null }]
  const html = await f.html()
  assert.match(html, /Theory practice is not yet available/)
  assert.doesNotMatch(html, /data-attempt-id|<details/)
  assert.match(html, new RegExp(`href="/courses/${slug}"`))
  f.state.result.materials = [{ question, feedback }, { question: { ...question, itemId: modelAnswer.itemId }, feedback: null }]
  const partial = await f.html()
  assert.equal((partial.match(/data-attempt-id/g) || []).length, 1)
  assert.match(partial, /model answers have not been published/)
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
    assert.doesNotMatch(html, /INST201|Institutional theory title|Explain management|data-attempt-id/)
    assert.match(html, /role="alert"/)
  }
}))

test('loading announces once and contains no answer fields or unverified course identity', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.equal((html.match(/Loading theory practice\./g) || []).length, 1)
  assert.match(html, /aria-busy="true"/)
  assert.doesNotMatch(html, /<textarea|<button|INST201|Explain management/)
}))
