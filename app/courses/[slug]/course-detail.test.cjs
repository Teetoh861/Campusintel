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
  // topics: the course's topic list as published_cbt_topics returns it (null: unreadable); progress per topic.
  const state = { result: full(), signedOut: false, sessionError: false, clientError: false, topics: [], progress: null,
    topicError: false, buildTime: { notes: true, cbtPractice: true, theory: false } }
  function StudentAccessGate() { return null }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const central = require(path.join(root, 'lib/courses/read-model.ts'))
    const topicModel = require(path.join(root, 'lib/practice/topics.ts'))
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
      // What a locked course publishes, from build-time data (lib/courses/build-time-study.test.cjs covers the real sources).
      if (name === '@/lib/courses/build-time-study') return { buildTimeStudy: () => state.buildTime }
      if (name === '@/lib/practice/server') return { practicePolicyFor: slug => {
        assert.equal(slug, 'central-route'); return { size: 50, seconds: 1800, sections: ['Configured first'] }
      } }
      if (name === '@/lib/practice/topics') return { ...topicModel,
        readPracticeTopics: async (supplied, courseId, sections) => {
          calls.push(['topics', courseId, sections]); assert.equal(supplied, client)
          if (state.topicError) throw new Error('private provider details')
          return state.topics
        },
        readTopicProgress: async (sessionId, courseId) => { calls.push(['progress', sessionId, courseId]); return state.progress },
      }
      if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () => {
        calls.push('entitlement'); return { status: 'unavailable' }
      }, readPlansOnSale: async () => state.plansOnSale === true }
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
      // The gate hands the page a continuity token for its background requests (opened notes topics).
      const child = gated.props.children('page-token')
      return child.type(child.props)
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
  assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route'],
    ['topics', 'repository-id', ['Configured first']], ['progress', 'live-session', 'repository-id']])
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /<h1[^>]*>Institutional title<\/h1>/)
  assert.match(html, /INST101 · Free/)
  assert.doesNotMatch(html, /STATIC 999|Static repository title|Difficulty|credits|Exam-critical|Sit the mock|Start quiz\b/)
  assert.doesNotMatch(html, /Confirmed for|Business Administration|Insurance|200 Level|First Semester|Second Semester/)
  assert.match(html, /data-course-view-slug="central-route"/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  assert.match(html, /data-bookmark="central-key"/)
  assert.equal(anchors(html).filter(link => link.includes('/courses/central-route/quiz')).length, 1,
    'a course without topics offers Exam mode only')
  const exam = anchors(html).filter(link => link.includes('href="/courses/central-route/quiz?mode=exam"'))
  assert.equal(text(exam[0]).trim(), 'Exam mode 50 questions · 30 min')
  assert.match(exam[0], /class="student-topic-row student-topic-card student-focus-control"/, 'the card is the Exam mode row itself')
  assert.doesNotMatch(html, /Start CBT practice|Questions available|student-topic-list|student-topic-choices|Instant feedback/)
  assert.doesNotMatch(html, /Practise by topic|\/practice"/, 'no way to a topic list the course does not have')
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
  assert.ok(html.indexOf('student-detail-rail') < html.indexOf('id="notes"'), 'the rail precedes the reading column')
}))

test('practice is one card: Practise by topic with one line about the topics, then Exam mode; no topic is listed here', async () => fixture(async f => {
  f.state.topics = [{ topic: 'Configured first', bankSize: 12 }, { topic: 'Ratios & Returns', bankSize: 1 },
    { topic: 'Third', bankSize: 20 }]
  const card = async () => {
    const html = await f.html()
    const section = html.slice(html.indexOf('id="cbtPractice"'), html.indexOf('id="theory"'))
    assert.equal((section.match(/class="student-topic-card student-topic-choices"/g) || []).length, 1, 'one card')
    assert.doesNotMatch(html, /student-topic-list|student-topic-number|\/quiz\?topic=|Configured first|Ratios|Third/,
      'the topics are on the page the card opens, never on the course page')
    assert.doesNotMatch(section, /student-meta|Pick a topic|marked as you go/, 'one line per choice and nothing else')
    return anchors(section).map(link => [link.match(/href="([^"]+)"/)[1], text(link).trim(),
      /class="student-topic-row student-focus-control"/.test(link)])
  }
  // Before any practice the line counts the topics.
  assert.deepEqual(await card(), [['/courses/central-route/practice', 'Practise by topic 3 topics', true],
    ['/courses/central-route/quiz?mode=exam', 'Exam mode 50 questions · 30 min', true]])
  // After practice it counts the topics practised, from the progress the topic rows already show.
  f.state.progress = new Map([['Configured first', { practised: 8, lastScore: { score: 6, total: 8 } }],
    ['Third', { practised: 3, lastScore: null }], ['Ratios & Returns', { practised: 0, lastScore: null }]])
  assert.deepEqual((await card())[0], ['/courses/central-route/practice', 'Practise by topic 2 of 3 topics practised', true])
  // Progress that cannot be read leaves the count; topics that cannot be read leave Exam mode only.
  f.state.progress = null
  assert.deepEqual((await card())[0], ['/courses/central-route/practice', 'Practise by topic 3 topics', true])
  f.state.topics = [{ topic: 'Only', bankSize: 4 }]
  assert.equal((await card())[0][1], 'Practise by topic 1 topic')
  f.state.topicError = true
  const fallback = await f.html()
  assert.doesNotMatch(fallback, /student-topic-choices|Practise by topic|\/practice"/)
  assert.equal(text(anchors(fallback).find(link => link.includes('?mode=exam'))).trim(), 'Exam mode 50 questions · 30 min')
  assert.match(fallback, /<h1[^>]*>Institutional title<\/h1>/, 'a failed topic read never makes the page unavailable')
}))

test('the three study cards share one width, and the course page lists no topic and no question', async () => fixture(async f => {
  f.state.topics = [{ topic: 'Configured first', bankSize: 12 }, { topic: 'Third', bankSize: 20 }]
  const html = await f.html()
  // Notes, Practice and Theory: each card carries student-topic-card, the one rule that sets a card's width.
  assert.deepEqual([...html.matchAll(/class="(student-topic-[^"]*student-topic-card[^"]*|student-topic-card[^"]*)"/g)].map(match => match[1]),
    ['student-topic-row student-topic-card student-focus-control', 'student-topic-card student-topic-choices',
      'student-topic-row student-topic-card student-focus-control'])
  const rows = fs.readFileSync(path.join(__dirname, '../../../styles/instant-practice.css'), 'utf8')
  assert.match(rows, /^\.student-topic-list, \.student-topic-card \{ max-width: 720px; \}$/m)
  assert.doesNotMatch(rows, /^\.student-topic-(list|card|row|choices) \{[^}]*max-width/m, 'no card sets a width of its own')
  // Every card is one line and its action: four links, in order.
  const cards = html.slice(html.indexOf('id="notes"'), html.indexOf('id="overview"'))
  assert.deepEqual(anchors(cards).map(link => text(link).trim()), ['Open notes 3 topics', 'Practise by topic 2 topics',
    'Exam mode 50 questions · 30 min', 'Start theory practice 2 questions'])
  assert.doesNotMatch(cards, /<ol|<ul|<li|student-detail-numbered|student-meta/, 'no list and no extra line between the cards')
  // The overview lists no topics either: not the stored syllabus, not the practice topics. The rest of it stays.
  assert.doesNotMatch(html, /Syllabus topics|Chapter one|>CH 1</)
  assert.match(text(html), /Course overview Published overview body\. Second paragraph\. Key takeaways 01 Takeaway Remember this Exam focus 01 Focus area Formula sheet Break-even/)
  assert.doesNotMatch(html, /Explore the topics/, 'no line about topics the overview no longer has')
  for (const file of ['page.tsx', 'sections.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /OFFICIAL_BANK_SECTIONS|overviewBankTopics|bankTopics/, file)
  }
}))

test('notes are one compact card that opens the topic list; no note is read on the course page', async () => fixture(async f => {
  const html = await f.html()
  const cards = anchors(html).filter(link => link.includes('href="/courses/central-route/notes"'))
  assert.equal(cards.length, 1)
  assert.equal(text(cards[0]).trim(), 'Open notes 3 topics')
  // The card is a topic row held to the width every study card and topic list shares: one rule sets them all.
  assert.match(cards[0], /class="student-topic-row student-topic-card student-focus-control"/)
  const rows = fs.readFileSync(path.join(__dirname, '../../../styles/instant-practice.css'), 'utf8')
  assert.match(rows, /^\.student-topic-list, \.student-topic-card \{ max-width: 720px; \}$/m)
  assert.doesNotMatch(rows, /^\.student-topic-(list|card|row) \{[^}]*max-width/m, 'neither sets a width of its own')
  for (const body of ['Plain body', 'Topic body', 'Point A', 'Trick body', 'Tip text']) assert.ok(!html.includes(body), body)
  assert.doesNotMatch(html, /data-note-item/, 'the plan-use tracker runs on the topic page, not here')
  const rails = [...html.matchAll(/<code>(.*?)<\/code>/g)].map(match => match[1].replace(/<[^>]*>/g, ''))
  assert.ok(rails.includes(FORMULA), 'overview formula inside the formula rail')
  assert.match(html, /x² \+ y²/)
  assert.doesNotMatch(html, /\\\(|\\frac|katex/)
  assert.match(html, /Published overview body\.\nSecond paragraph\./)
  assert.match(html, /Focus area/)
  assert.match(html, /Remember this/)
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
    assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/quiz?mode=exam"')).length, flags.cbtPractice ? 1 : 0)
    assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/theory"')).length, flags.theory ? 1 : 0)
    assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  }
  f.state.result = { status: 'ok', course: institutional(ready({ cbtPractice: true })), learning, practice: null }
  assert.doesNotMatch(await f.html(), /id="cbtPractice"|\/quiz[?"]/, 'the page never builds practice without central metadata')
}))

test('theory is one card: how many questions and Start theory practice; no question or exam tip shows here', async () => fixture(async f => {
  const theoryQuestions = [{ itemId: 't1', prompt: 'Unnumbered without answer' }, { itemId: 't2', prompt: 'Authored four', displayNumber: 4, examTip: 'Define first' },
    { itemId: 't3', prompt: 'Unnumbered with answer' }]
  // The theory page shows every question, with or without a suggested answer, so the card opens it either way.
  for (const theoryPractice of [false, true]) {
    f.state.result = { status: 'ok', course: institutional(ready({ theory: true })),
      learning: { ...learning, theoryQuestions, theoryPractice }, practice: null }
    const html = await f.html()
    const section = html.slice(html.indexOf('id="theory"'), html.indexOf('id="overview"'))
    const links = anchors(section)
    assert.equal(links.length, 1)
    assert.match(links[0], /href="\/courses\/central-route\/theory"/)
    assert.match(links[0], /class="student-topic-row student-topic-card student-focus-control"/)
    assert.equal(text(links[0]).trim(), 'Start theory practice 3 questions')
    assert.doesNotMatch(html, /Unnumbered|Authored four|Define first|Exam tip|>Q\d+<|student-detail-numbered"><li><span>Q/)
    assert.doesNotMatch(section, /student-meta|Likely written questions/, 'one line and its action, nothing else')
  }
  f.state.result.learning = { ...learning, theoryQuestions: theoryQuestions.slice(0, 1), theoryPractice: true }
  assert.match(text(await f.html()), /Start theory practice 1 question /)
}))

test('overview-only stays no-published-learning: identity, context and prominent Request Material, no Practice', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'no-published-learning', study: study({}) }),
    learning: { overview: learning.overview, notes: [], theoryQuestions: [], theoryPractice: false }, practice: null }
  const html = await f.html()
  assert.match(html, /Institutional title/)
  assert.match(html, /Study materials are not available\./)
  assert.match(html, /role="status"/)
  assert.match(html, /id="overview"/)
  assert.doesNotMatch(html, /id="notes"|id="cbtPractice"|id="theory"|\/quiz[?"]/)
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
  assert.doesNotMatch(html, /Confirmed for|Business Administration|Insurance/)
  assert.match(html, /Study materials are temporarily unavailable\./)
  assert.match(html, /role="alert"/)
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route"') && link.includes('Try again')))
  assert.ok(anchors(html).some(link => link.includes('href="/courses/central-route/materials"')))
  assert.doesNotMatch(html, /id="notes"|id="cbtPractice"|id="theory"|id="overview"|\/quiz[?"]/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  assert.match(html, /data-course-view-slug="central-route"/)
  assert.doesNotMatch(html, /student-detail-rail|Contents/, 'no empty contents rail without study sections')
  assert.match(html, /student-detail-workspace"><div class="student-detail-reading">/)
}))

test('a locked course keeps its identity, renders no study content or reading list, and points to Plan & Access', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'locked' }), learning: null, practice: null }
  const html = await f.html()
  assert.match(html, /<h1[^>]*>Institutional title<\/h1>/)
  assert.doesNotMatch(html, /Confirmed for|Business Administration|Insurance/)
  assert.match(text(html), /Included with full access Notes · CBT practice See how to unlock/)
  assert.doesNotMatch(html, /GST|open fully|open when you subscribe/, 'one line: what the course has, no repetition, no GST')
  assert.equal((html.match(/class="student-notice"/g) || []).length, 1, 'one notice')
  assert.ok(anchors(html).some(link => link.includes('href="/access"')))
  assert.doesNotMatch(html, /id="notes"|id="cbtPractice"|id="theory"|id="overview"|id="reading"|Core reading|\/quiz[?"]|\/theory"|\/materials"/)
  assert.doesNotMatch(html, /student-detail-rail|role="alert"/)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1, 'a locked course can still be bookmarked')
  // Nothing published: nothing to subscribe to, so no unlock action, and the page says so.
  f.state.buildTime = { notes: false, cbtPractice: false, theory: false }
  const empty = await f.html()
  assert.match(text(empty), /Study materials are not available\./)
  assert.doesNotMatch(empty, /href="\/access"|See how to unlock|Subscribe|Included with full access|Free pass/)
  assert.equal((empty.match(/class="student-notice"/g) || []).length, 1)
}))

test('repository-only renders repository identity and content without any fabricated institutional ownership', async () => fixture(async f => {
  f.state.result = { status: 'repository-only', course: repositoryOnly(ready({ notes: true, cbtPractice: true })), learning, practice }
  const html = await f.html()
  assert.match(html, /<h1[^>]*>Static repository title<\/h1>/)
  assert.match(html, /Additional study material · STATIC 999/)
  assert.match(html, /Check it against your course outline\./)
  assert.doesNotMatch(html, /have not been confirmed/)
  assert.doesNotMatch(html, /INST101|Institutional title|Confirmed for|Business Administration|Insurance|200 Level|Semester|Free/)
  assert.match(html, /id="notes"/)
  assert.equal(anchors(html).filter(link => link.includes('href="/courses/central-route/quiz?mode=exam"')).length, 1)
  assert.equal((html.match(/Bookmark control/g) || []).length, 1)
  f.state.result = { status: 'repository-only', course: repositoryOnly({ state: 'no-published-learning', study: study({}) }),
    learning: { overview: learning.overview, notes: [], theoryQuestions: [], theoryPractice: false }, practice: null }
  const empty = await f.html()
  assert.match(empty, /Study materials are not available\./)
  assert.doesNotMatch(empty, /\/quiz[?"]|INST101/)
  f.state.result = { status: 'repository-only', course: repositoryOnly({ state: 'temporarily-unavailable', reason: 'projection-failed' }),
    learning: null, practice: null }
  const failed = await f.html()
  assert.match(failed, /Study materials are temporarily unavailable\./)
  assert.match(failed, /Additional study material · STATIC 999/)
  assert.doesNotMatch(failed, /id="overview"|\/quiz[?"]/)
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
    ['unavailable', 'We couldn’t load this course.', '/courses/central-route'],
    ['invariant-failure', 'We couldn’t show the course details.', '/contact'],
  ]) {
    f.state.result = { status }
    const html = await f.html()
    assert.match(html, /<h1[^>]*>Course<\/h1>/)
    assert.ok(html.includes(expectedTitle), status)
    assert.ok(anchors(html).some(link => link.includes(`href="${href}"`)), href)
    assert.doesNotMatch(html, /INST101|Institutional title|STATIC 999|Static repository title|Bookmark control|data-course-view-slug|\/quiz[?"]/)
  }
  assert.ok(anchors(await f.html()).some(link => link.includes('href="/materials"')) === false, 'invariant failure routes to support, not material')
  f.state.result = { status: 'unavailable' }
  assert.ok(anchors(await f.html()).some(link => link.includes('href="/materials"')), 'global Request Material without a confirmed course')
  f.state.clientError = true
  assert.match(await f.html(), /We couldn’t load this course\./)
  f.state.clientError = false
  f.state.sessionError = true
  const html = await f.html()
  assert.match(html, /We couldn’t load this course\./)
  assert.doesNotMatch(html, /private provider details/)
}))

test('long course identity stays complete without exposing the eligibility matrix or re-deriving truth', async () => fixture(async f => {
  const course = institutional(ready({ notes: true }))
  course.code = 'LAG-VERY-LONG-INSTITUTIONAL-COURSE-CODE-2026'
  course.title = 'Very long institutional title '.repeat(12).trim()
  course.applicability = Array.from({ length: 40 }, (_, i) => tuple(ref('d' + i, 'Department ' + i), ref('l', '100 Level'), ref('p', 'First Semester')))
  f.state.result = { status: 'ok', course, learning, practice }
  const html = await f.html()
  assert.match(html, /LAG-VERY-LONG-INSTITUTIONAL-COURSE-CODE-2026/)
  assert.ok(html.includes(course.title))
  assert.doesNotMatch(html, /Department \d+|Confirmed for|100 Level|First Semester/)
  for (const file of ['page.tsx', 'sections.tsx', 'loading.tsx', 'BookmarkButton.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.doesNotMatch(source, /<svg|getCourseBySlug|getPublishedManagedCourse|projectStudentLearning|getUsableManagedQuiz|getQuizConfigurationByCourseSlug|DashedRing/, file)
  }
  const page = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
  assert.doesNotMatch(page, /'use client'|\/quiz`|\/quiz'|student-register|data-student-app|Course details unavailable|redirect\(/)
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

test('once plans are on sale, a locked course points to a plan in the new wording; closed keeps today\'s', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'locked' }), learning: null, practice: null }
  f.state.plansOnSale = true
  const open = text(await f.html())
  assert.match(open, /Included when you subscribe/)
  assert.doesNotMatch(open, /Included with full access|Early Access/)
  f.state.plansOnSale = false
  assert.match(text(await f.html()), /Included with full access/)
}))

test('outside-list detail shows the support lock without asking for a pass or rendering learning', async () => fixture(async f => {
  f.state.result = { status: 'ok', course: institutional({ state: 'locked', reason: 'outside-list' }), learning: null, practice: null }
  const html = await f.html()
  assert.match(html, /Institutional title/)
  assert.match(text(html), /Not in your courses this semester\. Message us to add it\./)
  assert.ok(anchors(html).some(link => /Message us/.test(link) && /href="\/contact"/.test(link)))
  assert.doesNotMatch(html, /Included with full access|Discovery|Confirmed for|id="notes"|id="cbtPractice"|id="theory"|id="reading"/)
  assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route']])
}))


test('course detail gives each selection recovery one notice and never asks for a pass', async () => fixture(async f => {
  for (const [reason, title, action] of [
    ['needs-selection', 'Confirm your courses for this semester.', 'Confirm my courses'],
    ['selection-locked', 'Your courses are set for another semester.', 'Message us'],
  ]) {
    f.calls.length = 0
    f.state.result = { status: 'ok', course: institutional({ state: 'locked', reason }), learning: null, practice: null }
    const html = await f.html()
    assert.ok(html.includes(title))
    assert.ok(html.includes('>' + action + '</a>'))
    assert.equal((html.match(/class="student-notice"/g) || []).length, 1)
    assert.equal(anchors(html).length, 1)
    assert.doesNotMatch(html, /Included with full access|Discovery|Confirmed for|id="notes"|id="reading"/)
    assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route']])
  }
}))

test('repository-only detail shows not-available without material sections or plan and add offers', async () => fixture(async f => {
  f.state.result = { status: 'repository-only', course: repositoryOnly({ state: 'not-available' }), learning: null, practice: null }
  const html = await f.html()
  assert.match(html, /Static repository title|Additional study material/)
  assert.match(html, /Study materials are not available./)
  assert.doesNotMatch(html, /Message us|Included with full access|See how to unlock|Core reading|id="notes"|id="reading"|Request material/)
  assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route']])
}))
