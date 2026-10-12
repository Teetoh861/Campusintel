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
  const files = [
    './[slug]/quiz/page.tsx', '../page.tsx', '../bookmarks/page.tsx', './[slug]/materials/page.tsx',
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
  const publishedState = { rows, available: true }
  try {
    const { Card } = require('../../components/chrome/Card.tsx')
    const renderCards = (entries) => React.createElement(React.Fragment, null,
      entries.map(({ id, cardProps }) => React.createElement(Card, { ...cardProps, key: id })))
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
      if (name === '@/lib/managed-content/published') return {
        getPublishedManagedCourse: async () => publishedState.available
          ? { status: 'ok', courseId, content: publishedState.rows }
          : { status: 'unavailable' },
      }
      if (name === '@/lib/managed-content/student-quiz') return {
        getStudentManagedQuiz: async slug => {
          if (slug !== course.slug) return { status: 'invalid-course' }
          if (!publishedState.available) return { status: 'unavailable' }
          const { getUsableManagedQuiz } = require('../../lib/managed-content/quiz.ts')
          const questions = publishedState.rows.filter(row => row.kind === 'cbt_question').map((row, index) => ({
            id: index + 1, questionId: row.question_id, question: row.payload.prompt,
            options: row.payload.options, correctAnswer: row.payload.correctOption,
            section: row.payload.section, publishedRevision: row.revision,
          }))
          const usable = getUsableManagedQuiz(slug, quiz, questions)
          return usable ? { status: 'ready', quiz: usable } : { status: 'unavailable' }
        },
      }
      if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') } }
      if (name === './QuizClient') return { QuizClient: function QuizClient() { return null } }
      if (name === './BookmarksClient') return { BookmarksClient: ({ catalog }) => renderCards(catalog) }
      // Gate behaviour is covered in components/auth; these tests exercise the granted content.
      if (name === '@/components/auth/PublicHomeBoundary') return { PublicHomeBoundary: ({ children }) => children }
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
      home: require(files[1]).default,
      bookmarks: require(files[2]).default,
      materials: granted(require(files[3]).default),
      destinations,
      publishedState,
    })
  } finally {
    restore()
  }
}

const params = { params: Promise.resolve({ slug: course.slug }) }

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

test('usable quiz reaches the quiz route with the published bank and repository policy', async () => fixture(validQuiz, async f => {
  const route = await f.quizRoute(params)
  assert.deepEqual(route.props.questions.map(question => question.questionId),
    validQuiz.questions.map(question => question.questionId))
  assert.equal(route.props.maxQuestions, validQuiz.maxQuizQuestions)
  assert.equal(route.props.timerSeconds, validQuiz.quizDurationMinutes * 60)
  assert.equal(route.props.totalInBank, validQuiz.questions.length)
}))

test('displayed bank counts come from questions students can attempt', async () => {
  await fixture({ ...validQuiz, totalQuestions: validQuiz.questions.length + 50 }, async f => {
    assert.equal((await f.quizRoute(params)).props.totalInBank, validQuiz.questions.length)
  })
})

test('published CBT edits and withdrawals affect the next quiz route read', async () => fixture(validQuiz, async f => {
  const question = f.publishedState.rows.find(row => row.kind === 'cbt_question')
  question.payload.prompt = 'Operator published a new prompt'
  question.revision = 2
  let route = await f.quizRoute(params)
  assert.equal(route.props.questions[0].question, 'Operator published a new prompt')
  assert.equal(route.props.questions[0].publishedRevision, 2)
  f.publishedState.rows = f.publishedState.rows.filter(row => row !== question)
  route = await f.quizRoute(params)
  assert.equal(route.props.totalInBank, validQuiz.questions.length - 1)
  assert.ok(route.props.questions.every(item => item.questionId !== question.question_id))
  f.publishedState.rows = f.publishedState.rows.filter(row => row.kind !== 'cbt_question')
  assert.match(renderToStaticMarkup(await f.quizRoute(params)), /quiz is temporarily unavailable/i)
}))

test('managed read unavailability fails closed on the quiz route', async () => fixture(validQuiz, async f => {
  f.publishedState.available = false
  assert.match(renderToStaticMarkup(await f.quizRoute(params)), /quiz is temporarily unavailable/i)
}))

test('missing or unusable quiz configuration makes the quiz route reject the attempt', async () => {
  for (const quiz of [undefined, { ...validQuiz, maxQuizQuestions: 0 },
    { ...validQuiz, quizDurationMinutes: 0 }, { ...validQuiz, quizDurationMinutes: 1e308 }]) {
    await fixture(quiz, async f => {
      assert.match(renderToStaticMarkup(await f.quizRoute(params)), /quiz is temporarily unavailable/i)
    })
  }
})

test('public home and saved cards never infer quiz readiness from repository questions', async () => fixture(validQuiz, async f => {
  const publicCards = () => [f.home(), f.bookmarks()].map(element => renderToStaticMarkup(element))
  const assertNeutral = html => {
    assert.match(html, new RegExp(`href="/courses/${course.slug}"`))
    assert.match(html, /View course/)
    assert.doesNotMatch(html, new RegExp(`href="${quizHref}"`))
    assert.doesNotMatch(html, /Start quiz|Timed quiz|Practice quizzes/)
    assert.doesNotMatch(html, new RegExp(`${validQuiz.questions.length} questions`))
    assert.doesNotMatch(html, new RegExp(`${validQuiz.quizDurationMinutes} min`))
  }
  publicCards().forEach(assertNeutral)

  // Repository data still exists, but the operator can withdraw all published CBT.
  const originalRows = f.publishedState.rows
  f.publishedState.rows = originalRows.filter(row => row.kind !== 'cbt_question')
  publicCards().forEach(assertNeutral)

  f.publishedState.rows = originalRows
  publicCards().forEach(assertNeutral)

  f.publishedState.available = false
  publicCards().forEach(assertNeutral)
}))
