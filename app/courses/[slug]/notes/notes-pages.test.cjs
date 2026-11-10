// app/courses/[slug]/notes/notes-pages.test.cjs — The notes pages: a topic list, then one topic per page with its
// practice and theory links, previous and next, and the plan-use tracker. The guide renderer turns a guide topic into
// React elements only: text from a payload is never HTML.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../../../..')
const { parseTopic } = require(path.join(root, 'scripts/managed-content/study-guides/parse.cjs'))
const { guideTopicPayload } = require(path.join(root, 'scripts/managed-content/study-guides.cjs'))

const sourceTopic = (code, name) => parseTopic(fs.readFileSync(
  path.join(root, 'scripts/managed-content/study-guides/source', code, name), 'utf8'), name)
const QUESTION = '11111111-1111-4111-8111-111111111111'
const listening = { itemId: 'g1', publishedRevision: 1,
  ...guideTopicPayload(sourceTopic('GST111', 'T1.md'), QUESTION, [{ topic: 'Listening Skills and Note-taking', named: false }]) }
const inventories = { itemId: 'g2', publishedRevision: 1,
  ...guideTopicPayload(sourceTopic('ACC-CM201', 'T4.md'), '22222222-2222-4222-8222-222222222222',
    [{ topic: 'IAS 2 Inventories', named: true }, { topic: 'IAS 16 Property, Plant and Equipment', named: true }]) }
const plain = { itemId: 'p1', publishedRevision: 1, title: 'Plain note', body: 'Plain body' }
const TRICK = 'BEQ = FC ÷ (P − v) × 1', EXAMPLE = 'FC = ₦1,000,000; P − v = ₦2,000 → 500 units'
const calculator = { itemId: 'c1', publishedRevision: 2, title: 'Trick note', body: 'Trick body', noteType: 'calculator_trick',
  example: EXAMPLE, formula: TRICK }
const topicNote = { itemId: 't1', publishedRevision: 1, title: 'Topic note', body: 'Topic body', noteType: 'topic_note',
  keyPoints: ['Point A', 'Point B'], examTip: 'Tip text' }

const route = { slug: 'use-of-english', href: '/courses/use-of-english', course: { slug: 'use-of-english', code: 'GST 111', title: 'Static' } }
const course = content => ({ institutionalCourseId: 'inst', code: 'GST111', title: 'Communication in English', isFree: true,
  applicability: [], repository: { state: 'shelved', repositoryCourseId: 'repo', contentKey: 'use-of-english', isShared: false, route },
  content })
const ready = { state: 'ready', study: { notes: true, cbtPractice: true, theory: true, overview: true } }
const full = () => ({ status: 'ok', course: course(ready),
  learning: { overview: null, notes: [listening, inventories, plain], theoryPractice: true,
    theoryQuestions: [{ itemId: QUESTION, prompt: 'A question' }] },
  practice: { href: '/courses/use-of-english/quiz', bankSize: 650, attemptSize: 50, timerSeconds: 1800 } })

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")

async function withTsx(run) {
  const tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    await run()
  } finally {
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
  }
}

async function pages(run) {
  const load = Module._load
  const state = { result: full(), signedOut: false }
  function StudentAccessGate() { return null }
  try {
    await withTsx(async () => {
      const central = require(path.join(root, 'lib/courses/read-model.ts'))
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return {
          redirect: destination => { throw new Error('redirect:' + destination) }, notFound: () => { throw new Error('notFound') } }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({ name: 'client' }) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
          state.signedOut ? null : { user: { id: 'student' }, sessionId: 'session' } }
        if (name === '@/lib/courses/read-model') return { ...central, getStudentCourseBySlugForVerifiedStudent: async () => state.result }
        if (name === '@/lib/entitlements/server') return { readPlansOnSale: async () => false }
        return load.call(this, name, ...args)
      }
      const list = require('./page.tsx').default
      const topic = require('./[topic]/page.tsx').default
      const render = async (element, returnPath) => {
        const gated = await element
        assert.equal(gated.type, StudentAccessGate)
        assert.equal(gated.props.returnPath, returnPath)
        const child = gated.props.children('page-token')
        return renderToStaticMarkup(await child.type(child.props))
      }
      await run({ state,
        list: () => render(list({ params: Promise.resolve({ slug: 'use-of-english' }) }), '/courses/use-of-english/notes'),
        topic: n => render(topic({ params: Promise.resolve({ slug: 'use-of-english', topic: n }) }), `/courses/use-of-english/notes/${n}`) })
    })
  } finally { Module._load = load }
}

test('the topic list links every topic to its own page, in order', async () => pages(async ({ list }) => {
  const html = await list()
  const rows = anchors(html).filter(link => link.includes('student-topic-row'))
    .map(link => [link.match(/href="([^"]+)"/)[1], text(link).trim()])
  assert.deepEqual(rows, [
    ['/courses/use-of-english/notes/1', '1 Listening Skills 5 lessons'],
    ['/courses/use-of-english/notes/2', '2 IAS 2 Inventories 5 lessons'],
    ['/courses/use-of-english/notes/3', '3 Plain note'],
  ])
  assert.match(html, /<h1[^>]*>Notes<\/h1>/)
  assert.match(text(html), /GST111 · Communication in English/)
  assert.ok(anchors(html).some(link => link.includes('href="/courses/use-of-english"') && /Back to course/.test(link)))
  assert.doesNotMatch(html, /data-note-item/, 'the list counts nothing as opened')
}))

test('a topic page shows the whole topic, its practice and theory links, and previous and next', async () => pages(async ({ topic }) => {
  const html = await topic('1')
  assert.match(html, /<h1[^>]*>Listening Skills<\/h1>/)
  assert.match(text(html), /GST111 · Topic 1 of 3/)
  // The tracker counts this topic as opened after 30 seconds on screen.
  assert.equal((html.match(/<div id="notes"[^>]*><article[^>]*data-note-item="g1"/g) ?? []).length, 1)
  assert.match(text(html), /What you must know what listening is and why it matters in lectures/)
  assert.equal((html.match(/<h2 class="student-guide-heading">Lesson 1\.\d+:/g) ?? []).length, 5)
  // Explain more is folded until the student opens it.
  assert.equal((html.match(/<details class="student-guide-more">/g) ?? []).length, 5)
  assert.doesNotMatch(html, /<details[^>]*\sopen/)
  assert.match(html, /<h2 class="student-guide-heading">One-minute recap<\/h2>/)
  assert.match(html, /<h2 class="student-guide-heading">Theory question<\/h2>/)
  const links = anchors(html).map(link => [decode(link.match(/href="([^"]+)"/)[1]), text(link).trim()])
  assert.ok(links.some(([href, label]) => label === 'Answer this question'
    && href === `/courses/use-of-english/theory?question=${QUESTION}#question-${QUESTION}`))
  assert.ok(links.some(([href, label]) => label === 'Practise this topic'
    && href === '/courses/use-of-english/quiz?topic=Listening Skills and Note-taking'.replaceAll(' ', '%20')))
  assert.ok(links.some(([href, label]) => href === '/courses/use-of-english/notes/2' && label === 'Next topic IAS 2 Inventories'))
  assert.ok(!links.some(([, label]) => label.startsWith('Previous topic')), 'the first topic has no previous')
  assert.ok(links.some(([href, label]) => href === '/courses/use-of-english/notes' && label === 'All topics'))
  assert.ok(anchors(html).filter(link => link.includes('/quiz?topic=')).every(link => !link.includes('→')), 'the practice button has no arrow')
}))

test('a topic covering several bank topics has one button per topic, named after it; the last topic has no next', async () => pages(async ({ topic, state }) => {
  const second = await topic('2')
  const buttons = anchors(second).filter(link => link.includes('/quiz?topic=')).map(link => text(link).trim())
  assert.deepEqual(buttons, ['IAS 2 Inventories', 'IAS 16 Property, Plant and Equipment'])
  assert.ok(!anchors(second).some(link => /Answer this question/.test(link)), 'no link for a question the theory page cannot practise')
  const last = await topic('3')
  assert.ok(!anchors(last).some(link => /Next topic/.test(link)))
  assert.ok(anchors(last).some(link => link.includes('href="/courses/use-of-english/notes/2"') && /Previous topic/.test(link)))
  // Without practice the student can open, there are no practice buttons.
  state.result = { ...full(), practice: null, course: course({ ...ready, study: { ...ready.study, cbtPractice: false } }) }
  assert.ok(!anchors(await topic('1')).some(link => link.includes('/quiz')))
}))

test('unknown topics, signed-out students, locked and empty courses never show a topic', async () => pages(async ({ topic, list, state }) => {
  for (const missing of ['0', '4', 'abc', '1.5']) await assert.rejects(topic(missing), /notFound/, missing)
  state.signedOut = true
  await assert.rejects(topic('1'), /redirect:/)
  state.signedOut = false
  state.result = { ...full(), course: course({ state: 'locked' }), learning: null, practice: null }
  const locked = await topic('1')
  assert.doesNotMatch(locked, /data-note-item|Listening/)
  state.result = { ...full(), learning: { ...full().learning, notes: [] } }
  assert.match(text(await list()), /Study materials are not available\./)
  state.result = { status: 'not-found' }
  await assert.rejects(list(), /notFound/)
}))

test('the guide renderer turns every payload text into escaped text, never HTML', async () => withTsx(async () => {
  const { GuideTopicBody, GuideBlocks } = require('../guide.tsx')
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>'
  const html = renderToStaticMarkup(React.createElement(GuideBlocks, { blocks: [
    { type: 'paragraph', text: [{ text: hostile, bold: true }] },
    { type: 'list', ordered: true, start: 4, items: [{ text: [{ text: hostile }], blocks: [{ type: 'preformatted', text: hostile }] }] },
    { type: 'table', header: [[{ text: hostile }], []], rows: [[[{ text: 'a', italic: true }], []]] },
  ] }))
  assert.doesNotMatch(html, /<img|<script/)
  // Four texts, and the table's accessible name made from its header.
  assert.equal((html.match(/&lt;script&gt;/g) ?? []).length, 5)
  assert.match(html, /<ol class="student-guide-list" start="4">/)
  assert.match(html, /<div class="student-guide-table" role="region" aria-label="[^"]+" tabindex="0"><table>/)
  assert.match(html, /<td><span><em>a<\/em><\/span><\/td><td><\/td>/)
  // Every span of a real topic is rendered, and inside a card the headings start at h4.
  const card = renderToStaticMarkup(React.createElement(GuideTopicBody, { topic: inventories, level: 4 }))
  assert.match(card, /<h4 class="student-guide-heading">Lesson 4\.1: What inventories are, and the scope of IAS 2<\/h4>/)
  const spans = []
  const walk = value => { if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') { if (typeof value.text === 'string' && !value.type) spans.push(value.text); Object.values(value).forEach(walk) } }
  walk(inventories.lessons)
  const rendered = decode(card)
  for (const span of spans) assert.ok(rendered.includes(span), span.slice(0, 60))
  assert.doesNotMatch(card, /Practise this topic|Answer this question/, 'no buttons without links')
}))

test('plain, topic and calculator notes render as before, with formulas and examples byte-identical', async () => withTsx(async () => {
  const { NoteArticle } = require('../sections.tsx')
  const html = [plain, topicNote, calculator].map(note => renderToStaticMarkup(React.createElement(NoteArticle, { note }))).join('')
  for (const expected of ['Plain note', 'Plain body', 'Topic note', 'Topic body', 'Point A', 'Point B', 'Tip text', 'Trick note',
    'Trick body', 'Calculator trick', 'Exam tip', 'Example']) assert.ok(html.includes(expected), expected)
  const rails = [...html.matchAll(/<code>(.*?)<\/code>/g)].map(match => match[1].replace(/<[^>]*>/g, ''))
  assert.ok(rails.includes(TRICK), 'calculator formula inside the formula rail')
  assert.ok(html.includes(EXAMPLE), 'example text untouched')
  assert.equal((html.match(/<article class="student-surface student-detail-note" data-note-item="[ptc]1">/g) ?? []).length, 3)
}))
