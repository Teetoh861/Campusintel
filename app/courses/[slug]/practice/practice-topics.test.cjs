// app/courses/[slug]/practice/practice-topics.test.cjs — Practise by topic: the page the course page's Practice card
// opens. It lists the course's topics in order, each with its count before practice and the student's progress after,
// with no arrow icons; a course with nothing to list goes back to its course page.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')

const root = path.join(__dirname, '../../../..')
const staticCourse = { slug: 'central-route', code: 'STATIC 999', title: 'Static repository title', contentKey: 'central-key', textbooks: [] }
const repository = { state: 'shelved', repositoryCourseId: 'repository-id', contentKey: 'central-key', isShared: false,
  route: { slug: 'central-route', href: '/courses/central-route', course: staticCourse } }
const ready = (flags = {}) => ({ state: 'ready', study: { notes: false, cbtPractice: true, theory: false, overview: false, ...flags } })
const practice = { href: '/courses/central-route/quiz', bankSize: 111, attemptSize: 50, timerSeconds: 1800 }
const institutional = (content, withPractice = practice) => ({ status: 'ok', learning: null, practice: withPractice,
  course: { institutionalCourseId: 'inst-id', code: 'INST101', title: 'Institutional title', isFree: false, applicability: [],
    repository, content } })
const TOPICS = [{ topic: 'Configured first', bankSize: 12 }, { topic: 'Ratios & Returns', bankSize: 1 }, { topic: 'Third', bankSize: 20 }]

const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim()

async function fixture(run) {
  return withTsx(async () => {
    const load = Module._load, calls = [], client = { name: 'verified client' }
    const state = { result: institutional(ready()), signedOut: false, clientError: false, topics: TOPICS, progress: null,
      topicError: false, plansOnSale: false, buildTime: { notes: true, cbtPractice: true, theory: false } }
    function StudentAccessGate() { return null }
    try {
      const topicModel = require(path.join(root, 'lib/practice/topics.ts'))
      Module._load = function(name, ...args) {
        if (name === 'server-only') return {}
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) },
          notFound: () => { throw new Error('notFound') } }
        if (name === '@/lib/supabase/server') return { createClient: async () => {
          calls.push('client'); if (state.clientError) throw new Error('private provider details'); return client
        } }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
          assert.equal(supplied, client); calls.push('verify')
          return state.signedOut ? null : { user: { id: 'verified-student' }, sessionId: 'live-session' }
        } }
        if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async (supplied, slug) => {
          assert.equal(supplied, client); calls.push(['lookup', slug]); return state.result
        } }
        if (name === '@/lib/courses/build-time-study') return { buildTimeStudy: () => state.buildTime }
        if (name === '@/lib/entitlements/server') return { readPlansOnSale: async () => state.plansOnSale }
        if (name === '@/lib/practice/server') return { practicePolicyFor: slug => {
          assert.equal(slug, 'central-route'); return { size: 50, seconds: 1800, sections: ['Configured first'] }
        } }
        if (name === '@/lib/practice/topics') return { ...topicModel,
          readPracticeTopics: async (supplied, courseId, sections) => {
            assert.equal(supplied, client); calls.push(['topics', courseId, sections])
            if (state.topicError) throw new Error('private provider details')
            return state.topics
          },
          readTopicProgress: async (sessionId, courseId) => { calls.push(['progress', sessionId, courseId]); return state.progress },
        }
        return load.call(this, name, ...args)
      }
      const route = require('./page.tsx')
      const granted = async (slug = 'central-route') => {
        const gated = await route.default({ params: Promise.resolve({ slug }) })
        assert.equal(gated.type, StudentAccessGate)
        assert.equal(gated.props.returnPath, `/courses/${slug}/practice`)
        const child = gated.props.children('page-token')
        return child.type(child.props)
      }
      await run({ state, calls, granted, html: async slug => renderToStaticMarkup(await granted(slug)), metadata: route.metadata })
    } finally { Module._load = load }
  })
}

test('the topics in order, each with its count before practice and its progress after, and no arrow icons', async () => fixture(async f => {
  f.state.progress = new Map([['Configured first', { practised: 8, lastScore: { score: 6, total: 8 } }],
    ['Third', { practised: 3, lastScore: null }]])
  const html = await f.html()
  assert.deepEqual(f.calls, ['client', 'verify', ['lookup', 'central-route'], ['topics', 'repository-id', ['Configured first']],
    ['progress', 'live-session', 'repository-id']])
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /<h1[^>]*>Practise by topic<\/h1>/)
  assert.match(html, /<p>INST101 · Institutional title<\/p>/)
  const rows = anchors(html).filter(link => link.includes('student-topic-row'))
    .map(link => [link.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&'), text(link)])
  assert.deepEqual(rows, [
    ['/courses/central-route/quiz?topic=Configured%20first', '1 Configured first 8 of 12 questions practised · Last score 6/8'],
    ['/courses/central-route/quiz?topic=Ratios%20%26%20Returns', '2 Ratios & Returns 1 question'],
    ['/courses/central-route/quiz?topic=Third', '3 Third 3 of 20 questions practised'],
  ], 'number, title and one line; the count before practice, the progress after, never both')
  assert.match(html, /<ol class="student-topic-list" aria-label="Topics">/)
  assert.doesNotMatch(html, /<svg|student-topic-go/, 'no arrow icons, like the notes topic list')
  // One way back, and nothing else to choose: Exam mode starts from the course page's card.
  assert.deepEqual(anchors(html).filter(link => !link.includes('student-topic-row')).map(link => [link.match(/href="([^"]+)"/)[1], text(link)]),
    [['/courses/central-route', 'Back to course']])
  assert.doesNotMatch(html, /Exam mode|mode=exam|student-meta|Pick a topic/)
  assert.deepEqual(f.metadata, { title: 'Practise by topic | CampusIntell', robots: { index: false, follow: false } })
}))

test('progress that cannot be read leaves each count; topics that cannot be read offer Try again and the way back', async () => fixture(async f => {
  assert.deepEqual(anchors(await f.html()).filter(link => link.includes('student-topic-row')).map(text),
    ['1 Configured first 12 questions', '2 Ratios & Returns 1 question', '3 Third 20 questions'])
  for (const unreadable of [state => { state.topics = null }, state => { state.topicError = true }]) {
    unreadable(f.state)
    const html = await f.html()
    assert.match(html, /role="alert"/)
    assert.match(text(html), /We couldn’t load the topics\. Try again Back to course$/)
    assert.deepEqual(anchors(html).map(link => link.match(/href="([^"]+)"/)[1]), ['/courses/central-route/practice', '/courses/central-route'])
    assert.doesNotMatch(html, /student-topic-list|private provider details/)
  }
  f.state.topics = TOPICS
  f.state.topicError = false
  f.state.result = institutional({ state: 'temporarily-unavailable', reason: 'publication-read-failed' }, null)
  assert.match(text(await f.html()), /We couldn’t load the topics\. Try again Back to course$/)
}))

test('a course with nothing to list goes back to its course page', async () => fixture(async f => {
  f.state.topics = []
  await assert.rejects(f.granted(), /redirect:\/courses\/central-route#cbtPractice$/, 'no topics: Exam mode is on the Practice card')
  for (const result of [institutional(ready(), null), institutional(ready({ cbtPractice: false })),
    institutional({ state: 'no-published-learning', study: ready().study }, null),
    { status: 'repository-only', learning: null, practice: null, course: { repository, content: { state: 'not-available' } } }]) {
    f.state.result = result
    await assert.rejects(f.granted(), /redirect:\/courses\/central-route$/, 'no practice: the course page says what the course has')
  }
}))

test('a locked course shows the one unlock notice; signed-out, unknown and unreadable courses show no topic', async () => fixture(async f => {
  f.state.result = institutional({ state: 'locked' }, null)
  const locked = await f.html()
  assert.match(locked, /<h1[^>]*>Practise by topic<\/h1>/)
  assert.match(text(locked), /Included with full access Notes · CBT practice See how to unlock Back to course$/)
  assert.equal((locked.match(/class="student-notice"/g) || []).length, 1)
  assert.doesNotMatch(locked, /student-topic-list|Configured first/)
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'topics'), false, 'no topic is read for a locked course')

  f.state.signedOut = true
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses%2Fcentral-route%2Fpractice$/)
  f.state.signedOut = false
  f.state.result = { status: 'signed-out' }
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses%2Fcentral-route%2Fpractice$/)
  f.state.result = { status: 'not-found' }
  await assert.rejects(f.granted('not-a-course'), /notFound/)
  for (const [status, title, href] of [['unavailable', 'We couldn’t load this course.', '/courses/central-route/practice'],
    ['invariant-failure', 'We couldn’t show the course details.', '/contact']]) {
    f.state.result = { status }
    const html = await f.html()
    assert.ok(html.includes(title), status)
    assert.deepEqual(anchors(html).map(link => link.match(/href="([^"]+)"/)[1]), [href])
    assert.doesNotMatch(html, /INST101|Institutional title|student-topic-list|Configured first/)
  }
  // A read that fails before the sign-in is known is a failed read, not a sign-out.
  f.state.clientError = true
  const failed = await f.html()
  assert.match(failed, /We couldn’t load this course\./)
  assert.doesNotMatch(failed, /private provider details|student-topic-list/)
}))

test('a repository-only course is named as additional study material, never as an institutional course', async () => fixture(async f => {
  f.state.result = { status: 'repository-only', learning: null, practice, course: { repository, content: ready() } }
  const html = await f.html()
  assert.match(html, /<p>Additional study material · Static repository title<\/p>/)
  assert.doesNotMatch(html, /INST101|Institutional title|STATIC 999/)
  assert.equal(anchors(html).filter(link => link.includes('student-topic-row')).length, 3)
}))
