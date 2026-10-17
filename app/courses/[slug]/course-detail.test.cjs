// app/courses/[slug]/course-detail.test.cjs — Course Detail composes central one-course truth without re-deriving it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../../..')
const ref = (id, label) => ({ id, label, isActive: true })
const tuple = (department, academicLevel, academicPeriod) => ({ department, academicLevel, academicPeriod })
const applicability = [
  tuple(ref('d1', 'Business Administration'), ref('l1', '200 Level'), ref('p1', 'First Semester')),
  tuple(ref('d2', 'Insurance'), ref('l1', '200 Level'), ref('p2', 'Second Semester')),
]
const staticCourse = { slug: 'central-route', code: 'STATIC 999', title: 'Static repository title',
  contentKey: 'central-key', textbooks: [{ title: 'Core reading', author: 'An Author', edition: '3rd ed.' }] }
const shelved = { state: 'shelved', repositoryCourseId: 'repository-id', contentKey: 'central-key', isShared: false,
  route: { slug: 'central-route', href: '/courses/central-route', course: staticCourse } }
const study = flags => ({ notes: false, cbtPractice: false, theory: false, overview: true, ...flags })
const institutional = content => ({ institutionalCourseId: 'inst-id', code: 'INST101', title: 'Institutional title',
  isFree: true, applicability, repository: shelved, content })
const repositoryOnly = content => ({ repository: shelved, content })
const FORMULA = 'BEQ = FC / (P − v)', TRICK = 'BEQ = FC ÷ (P − v) × 1', EXAMPLE = 'FC = ₦1,000,000; P − v = ₦2,000 → 500 units'
const learning = {
  overview: { title: 'Overview', body: 'Published overview body.\nSecond paragraph.', topics: [{ chapter: '1', description: 'Chapter one' }],
    examFocus: ['Focus area'], keyTakeaways: [{ title: 'Takeaway', description: 'Remember this' }],
    formulaSheet: [{ name: 'Break-even', formula: FORMULA, explanation: 'Contribution', example: 'x² + y²' }] },
  notes: [
    { itemId: 'n1', publishedRevision: 1, title: 'Plain note', body: 'Plain body' },
    { itemId: 'n2', publishedRevision: 1, title: 'Topic note', body: 'Topic body', noteType: 'topic_note', keyPoints: ['Point A', 'Point B'], examTip: 'Tip text' },
    { itemId: 'n3', publishedRevision: 2, title: 'Trick note', body: 'Trick body', noteType: 'calculator_trick', example: EXAMPLE, formula: TRICK },
  ],
  theoryQuestions: [{ itemId: 't1', prompt: 'Explain the concept', displayNumber: 1, examTip: 'Define first' },
    { itemId: 't2', prompt: 'Second prompt' }],
  theoryPractice: true,
}
const practice = { href: '/courses/central-route/quiz', bankSize: 111, attemptSize: 50, timerSeconds: 1800 }
const ready = flags => ({ state: 'ready', study: study(flags) })
const full = () => ({ status: 'ok', course: institutional(ready({ notes: true, cbtPractice: true, theory: true })), learning, practice })

const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const calls = [], client = { name: 'verified detail client' }
  const state = { result: full(), signedOut: false, sessionError: false, clientError: false }
  function StudentAccessGate() { return null }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const central = require(path.join(root, 'lib/courses/read-model.ts'))
    Module._load = function(name, ...args) {
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
      if (name === 'next/navigation') return {
        redirect: destination => { throw new Error('redirect:' + destination) },
        notFound: () => { throw new Error('notFound') },
      }
      if (name === '@/lib/supabase/server') return { createClient: async () => {
        calls.push('client'); if (state.clientError) throw new Error('private provider details'); return client
      } }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
        calls.push('verify'); assert.equal(supplied, client)
        if (state.sessionError) throw new Error('private provider details')
        return state.signedOut ? null : { user: { id: 'verified-student' }, sessionId: 'live-session' }
      } }
      if (name === '@/lib/courses/read-model') return { ...central,
        getStudentCourseBySlugForVerifiedStudent: async (supplied, slug) => {
          calls.push(['lookup', slug]); assert.equal(supplied, client); return state.result
        },
      }
      if (name === './BookmarkButton') return { BookmarkButton: props =>
        React.createElement('button', { type: 'button', 'data-bookmark': props.contentKey }, 'Bookmark control') }
      if (name === './CourseViewTracker') return { CourseViewTracker: ({ courseSlug }) =>
        React.createElement('span', { 'data-course-view-slug': courseSlug }) }
      if (args[0]?.filename.endsWith('/app/courses/[slug]/page.tsx') &&
          ['@/lib/data/quizzes', '@/lib/managed-content/published', '@/lib/managed-content/student-projection',
            '@/lib/managed-content/quiz', '@/lib/managed-content/student-quiz'].includes(name)) {
        throw new Error('page-level publication/quiz import forbidden: ' + name)
      }
      return load.call(this, name, ...args)
    }
    const page = require('./page.tsx').default
    const loading = require('./loading.tsx').default
    const granted = async (slug = 'central-route') => {
      const gated = await page({ params: Promise.resolve({ slug }) })
      assert.equal(gated.type, StudentAccessGate)
      assert.equal(gated.props.returnPath, `/courses/${slug}`)
      return gated.props.children.type(gated.props.children.props)
    }
    const html = async slug => renderToStaticMarkup(await granted(slug))
    await run({ state, calls, granted, html, loading })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('the gated page reads central truth once and institutional identity wins over static repository identity', async () => fixture(async f => {
  const html = await f.html()
  assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route']])
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /<h1[^>]*>Institutional title<\/h1>/)
  assert.match(html, /INST101 · Free/)
  assert.doesNotMatch(html, /STATIC 999|Static repository title|Difficulty|credits|Exam-critical|Sit the mock|Start quiz\b/)
  assert.match(html, /Confirmed for/)
  for (const label of ['Business Administration', 'Insurance', '200 Level', 'First Semester', 'Second Semester']) assert.ok(html.includes(label), label)
  assert.equal((html.match(/<li\b[^>]*>(?:<span>[^<]*<\/span>){3}<\/li>/g) || []).length, 2, 'two applicability tuples as stated')
  assert.match(html, /data-course-view-slug="central-route"/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  assert.match(html, /data-bookmark="central-key"/)
  assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/quiz"')).length, 1, 'exactly one Practice entry')
  assert.match(text(html), /Question bank 111 Per attempt 50 Time 30 min/)
  assert.match(html, /Start CBT practice/)
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route/theory"') && link.includes('Start theory practice')))
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route/materials"') && link.includes('Request material')))
  assert.ok(html.indexOf('id="notes"') < html.indexOf('id="cbtPractice"') && html.indexOf('id="cbtPractice"') < html.indexOf('id="theory"') &&
    html.indexOf('id="theory"') < html.indexOf('id="overview"') && html.indexOf('id="overview"') < html.indexOf('id="reading"'))
  assert.match(html, /Core reading/)
  // Approved desktop frame: a contents rail beside one bounded reading column, both inside the shared workspace.
  assert.match(html, /class="student-workspace student-page-workspace student-detail-workspace"><aside class="student-detail-rail"><nav aria-label="Study sections" class="student-detail-nav"><p class="student-detail-kicker student-detail-nav-label">Contents<\/p><ol>/)
  assert.deepEqual([...html.matchAll(/student-detail-nav-number">(\d\d)<\/span>([^<]+)</g)].map(match => [match[1], match[2]]),
    [['01', 'Notes'], ['02', 'CBT practice'], ['03', 'Theory'], ['04', 'Course overview'], ['05', 'Reading list']])
  assert.match(html, /<\/aside><div class="student-detail-reading">/)
  assert.ok(html.indexOf('student-detail-rail') < html.indexOf('applicability-title'), 'the rail precedes the reading column')
}))

test('notes render plain, topic and calculator payloads with formulas and examples byte-identical', async () => fixture(async f => {
  const html = await f.html()
  for (const expected of ['Plain note', 'Plain body', 'Topic note', 'Topic body', 'Point A', 'Point B', 'Tip text', 'Trick note', 'Trick body',
    'Calculator trick', 'Exam tip', 'Example']) assert.ok(html.includes(expected), expected)
  assert.ok(html.includes(`<code>${TRICK}</code>`), 'calculator formula inside the formula rail')
  assert.ok(html.includes(`<code>${FORMULA}</code>`), 'overview formula inside the formula rail')
  assert.ok(html.includes(EXAMPLE.replace(/₦/g, '₦')), 'example text untouched')
  assert.match(html, /x² \+ y²/)
  assert.doesNotMatch(html, /\\\(|\\frac|katex/)
  assert.match(html, /Published overview body\.\nSecond paragraph\./)
  assert.match(html, /Chapter one|Focus area|Remember this/)
  assert.match(html, /Q1<\/span>/)
  assert.match(html, /Q2<\/span>/)
  assert.match(html, /Explain the concept/)
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b|model answer|rubric|score/i)
}))

test('study families appear only from central flags, and Notes never comes from the overview', async () => fixture(async f => {
  for (const [flags, present] of [
    [{ notes: true }, ['notes', 'overview', 'reading']],
    [{ cbtPractice: true }, ['cbtPractice', 'overview', 'reading']],
    [{ theory: true }, ['theory', 'overview', 'reading']],
  ]) {
    f.state.result = { status: 'ok', course: institutional(ready(flags)), learning, practice }
    const html = await f.html()
    for (const id of ['notes', 'cbtPractice', 'theory', 'overview', 'reading']) {
      assert.equal(html.includes(`id="${id}"`), present.includes(id), `${JSON.stringify(flags)} → ${id}`)
    }
    assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/quiz"')).length, flags.cbtPractice ? 1 : 0)
    assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/theory"')).length, flags.theory ? 1 : 0)
    assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  }
  f.state.result = { status: 'ok', course: institutional(ready({ cbtPractice: true })), learning, practice: null }
  assert.doesNotMatch(await f.html(), /id="cbtPractice"|\/quiz"/, 'the page never builds practice without central metadata')
}))

test('theory practice is offered only with a usable model answer, and numbering matches Theory practice', async () => fixture(async f => {
  const { theoryDisplayNumbers } = require('../../../lib/theory-practice/numbering.ts')
  const theoryQuestions = [{ itemId: 't1', prompt: 'Unnumbered without answer' }, { itemId: 't2', prompt: 'Authored four', displayNumber: 4 },
    { itemId: 't3', prompt: 'Unnumbered with answer' }]
  f.state.result = { status: 'ok', course: institutional(ready({ theory: true })),
    learning: { ...learning, theoryQuestions, theoryPractice: false }, practice: null }
  const reading = await f.html()
  assert.match(reading, /id="theory"/)
  assert.match(reading, /Unnumbered without answer/, 'questions stay readable without practice')
  assert.equal(anchors(reading).filter(link => link.includes('/theory"')).length, 0)
  assert.doesNotMatch(reading, /Start theory practice/)
  f.state.result.learning = { ...f.state.result.learning, theoryPractice: true }
  const practicable = await f.html()
  assert.equal(anchors(practicable).filter(link => link.includes('href="/courses/central-route/theory"')).length, 1)
  const labels = [...practicable.matchAll(/<span>Q(\d+)<\/span>/g)].map(match => Number(match[1]))
  assert.deepEqual(labels, [5, 4, 6])
  assert.deepEqual(labels, theoryDisplayNumbers(theoryQuestions), 'Course Detail uses the shared numbering')
}))

test('overview-only stays no-published-learning: identity, context and prominent Request Material, no Practice', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'no-published-learning', study: study({}) }),
    learning: { overview: learning.overview, notes: [], theoryQuestions: [], theoryPractice: false }, practice: null }
  const html = await f.html()
  assert.match(html, /Institutional title/)
  assert.match(html, /Study content not yet available\./)
  assert.match(html, /role="status"/)
  assert.match(html, /id="overview"/)
  assert.doesNotMatch(html, /id="notes"|id="cbtPractice"|id="theory"|\/quiz"/)
  const requests = anchors(html).filter(link => link.includes('href="/courses/central-route/materials"'))
  assert.equal(requests.length, 1)
  assert.match(requests[0], /Request material/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
}))

test('temporary publication failure keeps confirmed identity and offers retry plus Request Material', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'temporarily-unavailable', reason: 'publication-read-failed' }),
    learning: null, practice: null }
  const html = await f.html()
  assert.match(html, /Institutional title/)
  assert.match(html, /Confirmed for/)
  assert.match(html, /Content temporarily unavailable\./)
  assert.match(html, /role="alert"/)
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route"') && link.includes('Try again')))
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route/materials"')))
  assert.doesNotMatch(html, /id="notes"|id="cbtPractice"|id="theory"|id="overview"|\/quiz"/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  assert.match(html, /data-course-view-slug="central-route"/)
  assert.doesNotMatch(html, /student-detail-rail|Contents/, 'no empty contents rail without study sections')
  assert.match(html, /student-detail-workspace"><div class="student-detail-reading">/)
}))

test('repository-only renders repository identity and content without any fabricated institutional ownership', async () => fixture(async f => {
  f.state.result = { status: 'repository-only', course: repositoryOnly(ready({ notes: true, cbtPractice: true })), learning, practice }
  const html = await f.html()
  assert.match(html, /<h1[^>]*>Static repository title<\/h1>/)
  assert.match(html, /Repository course · STATIC 999/)
  assert.match(html, /Institutional applicability has not been confirmed/)
  assert.doesNotMatch(html, /INST101|Institutional title|Confirmed for|Business Administration|Insurance|200 Level|Semester|Free/)
  assert.match(html, /id="notes"/)
  assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/quiz"')).length, 1)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  f.state.result = { status: 'repository-only', course: repositoryOnly({ state: 'no-published-learning', study: study({}) }),
    learning: { overview: learning.overview, notes: [], theoryQuestions: [], theoryPractice: false }, practice: null }
  const empty = await f.html()
  assert.match(empty, /Study content not yet available\./)
  assert.doesNotMatch(empty, /\/quiz"|INST101/)
  f.state.result = { status: 'repository-only', course: repositoryOnly({ state: 'temporarily-unavailable', reason: 'projection-failed' }),
    learning: null, practice: null }
  const failed = await f.html()
  assert.match(failed, /Content temporarily unavailable\./)
  assert.match(failed, /Repository course · STATIC 999/)
  assert.doesNotMatch(failed, /id="overview"|\/quiz"/)
}))

test('signed-out, not-found, unavailable and invariant failures never fall back to static identity', async () => fixture(async f => {
  f.state.signedOut = true
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses%2Fcentral-route/)
  assert.equal(f.calls.some(call => Array.isArray(call)), false, 'no lookup without a live session')
  f.state.signedOut = false
  f.state.result = { status: 'signed-out' }
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses%2Fcentral-route/)
  f.state.result = { status: 'not-found' }
  await assert.rejects(f.granted('not-a-course'), /notFound/)
  for (const [status, expectedTitle, href] of [
    ['unavailable', 'Course temporarily unavailable', '/courses/central-route'],
    ['invariant-failure', 'Course information needs attention', '/contact'],
  ]) {
    f.state.result = { status }
    const html = await f.html()
    assert.match(html, /<h1[^>]*>Course<\/h1>/)
    assert.ok(html.includes(expectedTitle), status)
    assert.ok(anchors(html).some(link => link.includes(`href="${href}"`)), href)
    assert.doesNotMatch(html, /INST101|Institutional title|STATIC 999|Static repository title|Bookmark control|data-course-view-slug|\/quiz"/)
  }
  assert.ok(anchors(await f.html()).some(link => link.includes('href="/materials"')) === false, 'invariant failure routes to support, not material')
  f.state.result = { status: 'unavailable' }
  assert.ok(anchors(await f.html()).some(link => link.includes('href="/materials"')), 'global Request Material without a confirmed course')
  f.state.clientError = true
  assert.match(await f.html(), /Course temporarily unavailable/)
  f.state.clientError = false
  f.state.sessionError = true
  const html = await f.html()
  assert.match(html, /Course temporarily unavailable/)
  assert.doesNotMatch(html, /private provider details/)
}))

test('long identity and large applicability stay complete and the page never re-derives truth', async () => fixture(async f => {
  const course = institutional(ready({ notes: true }))
  course.code = 'LAG-VERY-LONG-INSTITUTIONAL-COURSE-CODE-2026'
  course.title = 'Very long institutional title '.repeat(12).trim()
  course.applicability = Array.from({ length: 40 }, (_, i) => tuple(ref('d' + i, 'Department ' + i), ref('l', '100 Level'), ref('p', 'First Semester')))
  f.state.result = { status: 'ok', course, learning, practice }
  const html = await f.html()
  assert.match(html, /LAG-VERY-LONG-INSTITUTIONAL-COURSE-CODE-2026/)
  assert.ok(html.includes(course.title))
  assert.equal((html.match(/Department \d+/g) || []).length, 40)
  for (const file of ['page.tsx', 'sections.tsx', 'loading.tsx', 'BookmarkButton.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.doesNotMatch(source, /<svg|getCourseBySlug|getPublishedManagedCourse|projectStudentLearning|getUsableManagedQuiz|getQuizConfigurationByCourseSlug|DashedRing/, file)
  }
  const page = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
  assert.doesNotMatch(page, /'use client'|\/quiz`|\/quiz'|student-register|data-student-app|Course information needs attention|redirect\(/)
  assert.match(page, /StudentPage|ResultNotice|redirectForStudentState|STUDY_COPY/)
}))

test('loading boundary is inert: one announcement, no identity, no actions', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.match(html, /<h1[^>]*>Course<\/h1>/)
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
  assert.equal((html.match(/Loading course\./g) || []).length, 1)
  assert.doesNotMatch(html, /<a\b|<button\b|Bookmark|Practice|INST|animate-pulse/)
  assert.match(html, /aria-hidden="true"/)
}))
