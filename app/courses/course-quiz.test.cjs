const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

function installLoader() {
  const originalLoad = Module._load
  const originalExtensions = new Map(['.ts', '.tsx'].map(ext => [ext, Module._extensions[ext]]))
  const originalCache = { ...require.cache }
  // CommonJS compilation keeps TypeScript imports inside the alias interception.
  const compile = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file)
  for (const ext of originalExtensions.keys()) Module._extensions[ext] = compile
  Module._load = function(name, ...args) {
    const resolved = name.startsWith('@/') ? path.join(__dirname, '../..', name.slice(2)) : name
    return originalLoad.call(this, resolved, ...args)
  }
  return () => {
    Module._load = originalLoad
    for (const [ext, original] of originalExtensions) {
      if (original) Module._extensions[ext] = original; else delete Module._extensions[ext]
    }
    for (const file of Object.keys(require.cache)) {
      if (!Object.hasOwn(originalCache, file)) delete require.cache[file]
    }
    Object.assign(require.cache, originalCache)
  }
}

const { course, validQuiz } = (() => {
  const restore = installLoader()
  try {
    const course = require('../../lib/data/courses.ts').getCourseBySlug('financial-accounting-1')
    const validQuiz = require('../../lib/data/quizzes.ts').getQuizByCourseSlug(course.slug)
    return { course, validQuiz }
  } finally {
    restore()
  }
})()
const quizHref = `/courses/${course.slug}/quiz`

async function fixture(quiz, run) {
  // Course Detail itself is covered at the central-model boundary in [slug]/course-detail.test.cjs.
  // Bookmarks is covered at the central-model boundary in app/bookmarks; it no longer renders static cards.
  // The public landing page shows no course cards; its links are covered in components/landing.
  const files = [
    './[slug]/quiz/page.tsx', './[slug]/materials/page.tsx',
  ].map(file => require.resolve(file))
  const restore = installLoader()
  const originalLoad = Module._load
  const productNavigation = require('../../lib/product/student-navigation.ts')
  const destinations = structuredClone(productNavigation.STUDENT_DESTINATIONS)
  const courseId = '40000000-0000-4000-8000-000000000007'
  const overview = { item_id: '11111111-1111-4111-8111-111111111111', course_id: courseId,
    kind: 'course_overview', question_id: null, source_key: null, parent_item_id: null,
    revision: 1, payload: { title: course.title, body: course.overview } }
  const rows = [overview, ...(quiz?.questions ?? []).map((question, index) => ({
    item_id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
    course_id: courseId, kind: 'cbt_question', question_id: question.questionId,
    source_key: null, parent_item_id: null, revision: 1,
    payload: { prompt: question.question, options: question.options,
      correctOption: question.correctAnswer, section: question.section,
      ...(question.explanation ? { explanation: question.explanation } : {}) },
  }))]
  // locked: the plan excludes the course. practice: what the database answers for this student's attempts.
  const publishedState = { rows, available: true, locked: false, stateReads: 0,
    practice: { state: { status: 'none' }, attempts: new Map() } }
  try {
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/lib/product/student-navigation') return { ...productNavigation, STUDENT_DESTINATIONS: destinations }
      if (name === '@/lib/data/courses') return {
        courses: [course], getCourseBySlug: slug => slug === course.slug ? course : undefined,
      }
      if (name === '@/lib/data/quizzes') return {
        getQuizByCourseSlug: slug => slug === course.slug ? quiz : undefined,
        getQuizConfigurationByCourseSlug: slug => slug === course.slug && quiz
          ? { courseSlug: quiz.courseSlug, courseCode: quiz.courseCode, title: quiz.title,
            maxQuizQuestions: quiz.maxQuizQuestions, quizDurationMinutes: quiz.quizDurationMinutes,
            sections: quiz.sections } : undefined,
      }
      // The page reads only the student's own practice state and attempts; it never reads a bank.
      if (name === '@/lib/practice/server') return {
        readPracticeState: async (sessionId, courseId) => {
          assert.equal(sessionId, 'live-session')
          assert.equal(courseId, '40000000-0000-4000-8000-000000000007')
          publishedState.stateReads += 1
          return publishedState.practice.state
        },
        readPracticeAttempt: async (sessionId, attemptId) => {
          assert.equal(sessionId, 'live-session')
          return publishedState.practice.attempts.get(attemptId) ?? { status: 'not-found' }
        },
        practicePolicyFor: () => ({ size: 50, seconds: 1800, sections: ['First', 'Second'] }),
      }
      // The course's topic list, for Next topic: counts only, read on the student's own client.
      if (name === '@/lib/practice/topics') return { readPracticeTopics: async (_client, courseId, sections) => {
        assert.equal(courseId, '40000000-0000-4000-8000-000000000007')
        assert.deepEqual(sections, ['First', 'Second'])
        return [{ topic: 'Bookkeeping & Errors', bankSize: 15 }, { topic: 'Cost & Management Accounting', bankSize: 24 }]
      } }
      // The quiz route reads central one-course truth on a request-scoped client before any bank read.
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ fixture: 'request-scoped client' }) }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
        ({ user: { id: 'verified-student' }, sessionId: 'live-session' }) }
      if (name === '@/lib/courses/read-model') return {
        getStudentCourseBySlugForVerifiedStudent: async (_client, slug) => {
          if (slug !== course.slug) return { status: 'not-found' }
          const repository = { state: 'shelved', repositoryCourseId: courseId, contentKey: course.contentKey, isShared: null,
            route: { slug: course.slug, href: `/courses/${course.slug}`, course } }
          const base = { institutionalCourseId: 'fixture-institutional', code: course.code, title: course.title,
            isFree: false, applicability: [], repository }
          if (publishedState.locked) return { status: 'ok', learning: null, practice: null,
            course: { ...base, content: { state: 'locked' } } }
          if (!publishedState.available) return { status: 'ok', learning: null, practice: null,
            course: { ...base, content: { state: 'temporarily-unavailable', reason: 'publication-read-failed' } } }
          const { getUsableManagedQuiz } = require('../../lib/managed-content/quiz.ts')
          // The bank size is the count-only summary of the published rows.
          const usable = getUsableManagedQuiz(course.slug, quiz,
            publishedState.rows.filter(row => row.kind === 'cbt_question').length)
          const study = { notes: false, cbtPractice: Boolean(usable), theory: false, overview: true }
          return { status: 'ok', learning: null, course: { ...base, content: { state: 'ready', study } },
            practice: usable ? { href: usable.href, bankSize: usable.bankSize, attemptSize: usable.attemptSize,
              timerSeconds: usable.timerSeconds } : null }
        },
      }
      if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') },
        redirect: href => { throw new Error(`redirect:${href}`) } }
      if (name === './QuizClient') return { QuizClient: function QuizClient() { return null } }
      // Gate behaviour is covered in components/auth; these tests exercise the granted content.
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate: ({ children }) => children }
      return originalLoad.call(this, name, ...args)
    }
    for (const file of files) delete require.cache[file]
    const granted = page => async props => {
      const children = (await page(props)).props.children
      const content = typeof children === 'function' ? children('server-page-token') : children
      return content.type(content.props)
    }
    await run({
      quizRoute: granted(require(files[0]).default),
      materials: granted(require(files[1]).default),
      destinations,
      publishedState,
    })
  } finally {
    restore()
  }
}

const params = { params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({}) }
// Exam mode's own entry from the course page.
const exam = () => ({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ mode: 'exam' }) })
const withTopic = topic => ({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ topic }) })
const withAttempt = attempt => ({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ attempt }) })
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const graded = (courseId = '40000000-0000-4000-8000-000000000007') => ({ status: 'graded', now: '2026-10-24T10:30:00Z',
  attempt: { status: 'submitted', id: ATTEMPT, courseId, mode: 'exam', topic: null, intent: 'new', redoOf: null, startedAt: '2026-10-24T10:00:00Z',
    deadlineAt: '2026-10-24T10:30:00Z', durationSeconds: 1800, questionCount: 50, bankSize: 150, questions: [],
    result: { score: 7, total: 50, timedOut: false, finishedAt: '2026-10-24T10:20:00Z' } } })

test('material breadcrumbs consume canonical Dashboard and All Courses destinations', async () => fixture(validQuiz, async f => {
  const breadcrumbLinks = element => {
    const html = renderToStaticMarkup(element)
    const breadcrumb = html.match(/<nav\b[^>]*aria-label="Breadcrumb"[^>]*>(.*?)<\/nav>/s)?.[1]
    assert.ok(breadcrumb, 'course breadcrumb landmark')
    return [...breadcrumb.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)]
      .map(([, href, label]) => [label, href])
  }
  const expected = [['Dashboard', '/dashboard'], ['All Courses', '/courses']]
  assert.deepEqual(breadcrumbLinks(await f.materials(params)), [...expected, [course.code, `/courses/${course.slug}`]])

  // A changed canonical contract must flow through, without local labels or hrefs.
  f.destinations.dashboard = { id: 'dashboard', href: '/home-regression', label: 'Student home' }
  f.destinations.courses = { id: 'courses', href: '/library-regression', label: 'Course library' }
  const updated = [['Student home', '/home-regression'], ['Course library', '/library-regression']]
  assert.deepEqual(breadcrumbLinks(await f.materials(params)), [...updated, [course.code, `/library-regression/${course.slug}`]])
}))

test('fixture restores loaders and the module cache after success and failure', async () => {
  const originalLoad = Module._load
  const originalTs = Module._extensions['.ts']
  const originalTsx = Module._extensions['.tsx']
  const originalCache = { ...require.cache }
  for (const fail of [false, true]) {
    const result = fixture(validQuiz, async () => {
      if (fail) throw new Error('fixture failure')
    })
    if (fail) await assert.rejects(result, /fixture failure/); else await result
    assert.equal(Module._load, originalLoad)
    assert.equal(Module._extensions['.ts'], originalTs)
    assert.equal(Module._extensions['.tsx'], originalTsx)
    assert.deepEqual({ ...require.cache }, originalCache)
  }
})

test('a fresh start is briefed with the server count and time, and the page never carries a question', async () => fixture(validQuiz, async f => {
  const route = await f.quizRoute(exam())
  assert.deepEqual(route.props.initial, { kind: 'intro' })
  assert.deepEqual(route.props.brief, { questionCount: validQuiz.maxQuizQuestions,
    durationSeconds: validQuiz.quizDurationMinutes * 60 })
  assert.equal(route.props.bankSize, validQuiz.questions.length)
  assert.equal(route.props.lastResultHref, null)
  assert.doesNotMatch(JSON.stringify(route.props), /correct|options|explanation|"prompt"|"question"/i,
    'no question, option or answer reaches the page before an attempt starts')
}))

test('published withdrawals affect the next brief; an empty bank is not built', async () => fixture(validQuiz, async f => {
  const question = f.publishedState.rows.find(row => row.kind === 'cbt_question')
  f.publishedState.rows = f.publishedState.rows.filter(row => row !== question)
  assert.equal((await f.quizRoute(exam())).props.bankSize, validQuiz.questions.length - 1)
  f.publishedState.rows = f.publishedState.rows.filter(row => row.kind !== 'cbt_question')
  const html = renderToStaticMarkup(await f.quizRoute(exam()))
  assert.match(html, /CBT practice is not available for this course/)
  assert.doesNotMatch(html, /temporarily unavailable|Try again/i, 'a bank that was never built is not a temporary failure')
}))

test('practice by topic: a bare visit goes to the course\'s topic list; a topic starts its instant feedback', async () => fixture(validQuiz, async f => {
  await assert.rejects(f.quizRoute(params), new RegExp(`redirect:/courses/${course.slug}#cbtPractice`),
    'there is no choice of mode: practice starts from the topic list')
  const route = await f.quizRoute(withTopic('Bookkeeping & Errors'))
  assert.deepEqual(route.props.initial, { kind: 'topic', topic: 'Bookkeeping & Errors' })
  assert.deepEqual(route.props.topics, ['Bookkeeping & Errors', 'Cost & Management Accounting'], 'in order, for Next topic')
  assert.doesNotMatch(JSON.stringify(route.props), /correct|options|explanation|"prompt"|"question"/i)
  f.publishedState.locked = true
  const html = renderToStaticMarkup(await f.quizRoute(withTopic('Bookkeeping & Errors')))
  assert.match(html, /Included with full access/, 'a locked course starts no topic')
}))

test('switching topics: another topic starts (closing the open run); the same topic reopens it; an open exam blocks practice', async () => fixture(validQuiz, async f => {
  const OPEN = '55555555-5555-4555-8555-555555555555'
  const openInstant = { status: 'ready', now: '2026-10-24T10:00:00Z', attempt: { status: 'in_progress', id: OPEN,
    courseId: '40000000-0000-4000-8000-000000000007', mode: 'instant', topic: 'Bookkeeping & Errors', intent: 'new',
    redoOf: null, startedAt: '2026-10-24T10:00:00Z', deadlineAt: '2026-10-24T13:00:00Z', durationSeconds: 10800,
    questionCount: 10, bankSize: 15, saved: { revision: 0, answers: {} },
    questions: [{ questionId: OPEN, prompt: 'P', options: ['A', 'B'], section: 'Bookkeeping & Errors' }] } }
  f.publishedState.practice.state = { status: 'open', now: '2026-10-24T10:00:00Z', attempt: { id: OPEN, mode: 'instant',
    deadlineAt: '2026-10-24T13:00:00Z', questionCount: 10, answered: 3, score: null, bankSize: 15 } }
  f.publishedState.practice.attempts.set(OPEN, openInstant)
  assert.deepEqual((await f.quizRoute(withTopic('Cost & Management Accounting'))).props.initial,
    { kind: 'topic', topic: 'Cost & Management Accounting' }, 'another topic starts; the database closes the open run')
  assert.equal((await f.quizRoute(withTopic('Bookkeeping & Errors'))).props.initial.kind, 'open', 'the same topic reopens it')
  assert.equal((await f.quizRoute(params)).props.initial.kind, 'open', 'a bare visit resumes the open run')
  f.publishedState.practice.state = { status: 'open', now: '2026-10-24T10:00:00Z', attempt: { id: ATTEMPT, mode: 'exam',
    deadlineAt: '2026-10-24T10:18:30Z', questionCount: 50, answered: 12, score: null, bankSize: 150 } }
  const html = renderToStaticMarkup(await f.quizRoute(withTopic('Bookkeeping & Errors')))
  assert.match(html, /Finish your exam first\./)
  assert.match(html, new RegExp(`href="${quizHref}\\?attempt=${ATTEMPT}"[^>]*>Resume exam<`))
  assert.doesNotMatch(html, /QuizClient/, 'no practice starts while the exam is open')
}))

test('the open attempt comes first: resume, whatever access is now (D7)', async () => fixture(validQuiz, async f => {
  f.publishedState.practice.state = { status: 'open', now: '2026-10-24T10:00:00Z', attempt: { id: ATTEMPT,
    deadlineAt: '2026-10-24T10:18:30Z', questionCount: 50, answered: 12, score: null, bankSize: 150 } }
  let route = await f.quizRoute(params)
  assert.deepEqual(route.props.initial, { kind: 'resume', attemptId: ATTEMPT, answered: 12, total: 50, minutesLeft: 18 })
  f.publishedState.locked = true
  route = await f.quizRoute(params)
  assert.equal(route.props.initial.kind, 'resume', 'an attempt started may always finish')
  assert.equal(route.props.brief, null, 'but nothing new may start')
}))

test('the latest graded attempt is offered, and an attempt URL reloads its result', async () => fixture(validQuiz, async f => {
  f.publishedState.practice.state = { status: 'graded', now: '2026-10-24T10:30:00Z', attempt: { id: ATTEMPT, mode: 'exam',
    deadlineAt: '2026-10-24T10:30:00Z', questionCount: 50, answered: 12, score: 7, bankSize: 150 } }
  f.publishedState.practice.attempts.set(ATTEMPT, graded())
  let route = await f.quizRoute(exam())
  assert.deepEqual([route.props.initial.kind, route.props.initial.latest], ['graded', true])
  assert.equal(route.props.lastResultHref, `${quizHref}?attempt=${ATTEMPT}`)
  route = await f.quizRoute(withAttempt(ATTEMPT))
  assert.deepEqual([route.props.initial.kind, route.props.initial.latest, route.props.initial.attempt.id],
    ['graded', false, ATTEMPT])
  f.publishedState.locked = true
  route = await f.quizRoute(withAttempt(ATTEMPT))
  assert.equal(route.props.initial.kind, 'graded', 'a graded review stays the student\'s after access ends (D7)')
  assert.equal(route.props.brief, null, 'with no new attempt offered')
  f.publishedState.locked = false
  f.publishedState.practice.attempts.set(ATTEMPT, graded('40000000-0000-4000-8000-000000000001'))
  let html = renderToStaticMarkup(await f.quizRoute(withAttempt(ATTEMPT)))
  assert.match(html, /This practice result isn’t available/, 'an attempt of another course is not shown here')
  html = renderToStaticMarkup(await f.quizRoute(withAttempt('44444444-4444-4444-8444-444444444444')))
  assert.match(html, /This practice result isn’t available/, 'nor an attempt the student does not own')
}))

test('managed read unavailability fails closed on the quiz route', async () => fixture(validQuiz, async f => {
  f.publishedState.available = false
  const html = renderToStaticMarkup(await f.quizRoute(exam()))
  assert.match(html, /temporarily unavailable/i)
  assert.match(html, /couldn’t load the practice questions just now/)
  assert.match(html, new RegExp(`href="${quizHref}"[^>]*>Try again`))
  assert.doesNotMatch(html, /not available for this course/)
}))

test('a locked course with no attempt of the student\'s shows the plan notice', async () => fixture(validQuiz, async f => {
  f.publishedState.locked = true
  const html = renderToStaticMarkup(await f.quizRoute(exam()))
  assert.match(html, /Included with full access/)
  assert.match(html, /href="\/access"/)
  assert.doesNotMatch(html, /temporarily unavailable/i)
  assert.equal(f.publishedState.stateReads, 1, 'the student\'s own attempts are read first')
}))

test('an unreadable practice state fails closed with a retry', async () => fixture(validQuiz, async f => {
  f.publishedState.practice.state = { status: 'unavailable' }
  const html = renderToStaticMarkup(await f.quizRoute(exam()))
  assert.match(html, /couldn’t load the practice questions just now/)
  assert.match(html, new RegExp(`href="${quizHref}"[^>]*>Try again`))
}))

test('missing or unusable quiz configuration makes the quiz route reject the attempt', async () => {
  for (const quiz of [undefined, { ...validQuiz, maxQuizQuestions: 0 },
    { ...validQuiz, quizDurationMinutes: 0 }, { ...validQuiz, quizDurationMinutes: 1e308 }]) {
    await fixture(quiz, async f => {
      const html = renderToStaticMarkup(await f.quizRoute(exam()))
      assert.match(html, /CBT practice is not available for this course/)
      assert.doesNotMatch(html, /QuizClient|Start practice/)
    })
  }
})
