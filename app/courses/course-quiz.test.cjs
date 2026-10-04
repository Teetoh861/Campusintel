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

const { getUsableCourseQuiz, course, validQuiz } = (() => {
  const restore = installLoader()
  try {
    const { getUsableCourseQuiz } = require('../../lib/data/quiz-availability.ts')
    const course = require('../../lib/data/courses.ts').getCourseBySlug('financial-accounting-1')
    const validQuiz = require('../../lib/data/quizzes.ts').getQuizByCourseSlug(course.slug)
    return { getUsableCourseQuiz, course, validQuiz }
  } finally {
    restore()
  }
})()
const quizHref = `/courses/${course.slug}/quiz`

async function fixture(quiz, run) {
  const files = [
    './[slug]/page.tsx', './[slug]/quiz/page.tsx', './[slug]/CourseToc.tsx', './[slug]/MobileCourseNav.tsx',
    './page.tsx', '../page.tsx', '../bookmarks/page.tsx',
  ].map(file => require.resolve(file))
  const bookmarkControl = () => React.createElement('button', { type: 'button' }, 'Bookmark control')
  const restore = installLoader()
  const originalLoad = Module._load
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
      if (name === './BookmarkButton') return { BookmarkButton: bookmarkControl }
      if (name === './CourseViewTracker') return { CourseViewTracker: ({ courseSlug }) =>
        React.createElement('span', { 'data-course-view-slug': courseSlug }) }
      if (name === './CourseAccordion') return { CourseAccordion: ({ sections }) =>
        React.createElement(React.Fragment, null, sections.map(section =>
          React.createElement('section', { key: section.id }, section.content))) }
      if (name === './CourseDirectory') return { CourseDirectory: ({ items }) => renderCards(items) }
      if (name === './BookmarksClient') return { BookmarksClient: ({ catalog }) => renderCards(catalog) }
      // Gate behaviour is covered in components/auth; these tests exercise the granted content.
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate: ({ children }) => children }
      return originalLoad.call(this, name, ...args)
    }
    for (const file of files) delete require.cache[file]
    const granted = page => async props => {
      const content = (await page(props)).props.children
      return content.type(content.props)
    }
    await run({
      detail: granted(require(files[0]).default),
      quizRoute: granted(require(files[1]).default),
      CourseToc: require(files[2]).CourseToc,
      MobileCourseNav: require(files[3]).MobileCourseNav,
      directory: granted(require(files[4]).default),
      home: require(files[5]).default,
      bookmarks: require(files[6]).default,
      publishedState,
    })
  } finally {
    restore()
  }
}

const params = { params: Promise.resolve({ slug: course.slug }) }

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

test('usable quiz requires a matching course and a nonempty timed attempt', () => {
  const ready = getUsableCourseQuiz(course, validQuiz)
  assert.equal(ready.href, quizHref)
  assert.equal(ready.bankSize, validQuiz.questions.length)
  assert.equal(ready.attemptSize, Math.min(validQuiz.maxQuizQuestions, validQuiz.questions.length))
  assert.equal(ready.timerSeconds, validQuiz.quizDurationMinutes * 60)
  for (const quiz of [
    undefined,
    { ...validQuiz, courseSlug: 'different-course' },
    { ...validQuiz, questions: [] },
    { ...validQuiz, maxQuizQuestions: 0 },
    { ...validQuiz, maxQuizQuestions: 0.5 },
    { ...validQuiz, quizDurationMinutes: 0 },
    { ...validQuiz, quizDurationMinutes: Infinity },
    { ...validQuiz, quizDurationMinutes: 1e308 },
  ]) assert.equal(getUsableCourseQuiz(course, quiz), null)
})

test('usable quiz keeps both course-detail entry points and the quiz route', async () => fixture(validQuiz, async f => {
  const html = renderToStaticMarkup(await f.detail(params))
  assert.equal((html.match(new RegExp(`href="${quizHref}"`, 'g')) || []).length, 2)
  assert.match(html, /Start quiz/)
  assert.match(html, /Start practice quiz/)
  assert.match(html, /Sit the mock/)
  assert.match(html, new RegExp(`${Math.min(validQuiz.maxQuizQuestions, validQuiz.questions.length)} questions per attempt`))
  assert.match(html, new RegExp(`${validQuiz.questions.length}-question bank`))
  const route = await f.quizRoute(params)
  assert.deepEqual(route.props.questions.map(question => question.questionId),
    validQuiz.questions.map(question => question.questionId))
  assert.equal(route.props.maxQuestions, validQuiz.maxQuizQuestions)
  assert.equal(route.props.timerSeconds, validQuiz.quizDurationMinutes * 60)
  assert.equal(route.props.totalInBank, validQuiz.questions.length)
}))

test('course view instrumentation is present only for a canonical detail page', async () => fixture(validQuiz, async f => {
  const html = renderToStaticMarkup(await f.detail(params))
  assert.match(html, new RegExp(`data-course-view-slug="${course.slug}"`))
  await assert.rejects(f.detail({ params: Promise.resolve({ slug: 'not-a-course' }) }), /notFound/)
}))

test('displayed bank counts come from questions students can attempt', async () => {
  await fixture({ ...validQuiz, totalQuestions: validQuiz.questions.length + 50 }, async f => {
    const html = renderToStaticMarkup(await f.detail(params))
    assert.match(html, new RegExp(`${validQuiz.questions.length}-question bank`))
    assert.doesNotMatch(html, new RegExp(`${validQuiz.questions.length + 50}-question bank`))
    assert.equal((await f.quizRoute(params)).props.totalInBank, validQuiz.questions.length)
  })
})

test('next student request uses managed overview and theory publication without code fallback', async () => fixture(validQuiz, async f => {
  f.publishedState.rows[0].payload.body = 'Managed publication replaces the repository overview.'
  let html = renderToStaticMarkup(await f.detail(params))
  assert.match(html, /Managed publication replaces the repository overview/)
  assert.doesNotMatch(html, new RegExp(course.overview.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  f.publishedState.rows.push({ item_id: '33333333-3333-4333-8333-333333333333',
    course_id: '40000000-0000-4000-8000-000000000007', kind: 'theory_question',
    question_id: null, source_key: 'theory:1', parent_item_id: null, revision: 2,
    payload: { prompt: 'Managed theory prompt' } })
  html = renderToStaticMarkup(await f.detail(params))
  assert.match(html, /Managed theory prompt/)
  f.publishedState.rows = f.publishedState.rows.filter(row =>
    row.kind !== 'course_overview' && row.kind !== 'theory_question')
  html = renderToStaticMarkup(await f.detail(params))
  assert.doesNotMatch(html, /Managed publication replaces the repository overview|Managed theory prompt/)
  assert.doesNotMatch(html, new RegExp(course.overview.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}))

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

test('managed read unavailability fails closed on detail, quiz and course directory', async () => fixture(validQuiz, async f => {
  f.publishedState.available = false
  assert.match(renderToStaticMarkup(await f.detail(params)), /Learning content is temporarily unavailable/)
  assert.match(renderToStaticMarkup(await f.quizRoute(params)), /quiz is temporarily unavailable/i)
  assert.match(renderToStaticMarkup(await f.directory()), /Course content is temporarily unavailable/)
}))

test('missing or unusable quiz removes all course-detail claims and the route rejects it', async () => {
  for (const quiz of [undefined, { ...validQuiz, maxQuizQuestions: 0 },
    { ...validQuiz, quizDurationMinutes: 0 }, { ...validQuiz, quizDurationMinutes: 1e308 }]) {
    await fixture(quiz, async f => {
      const tree = await f.detail(params)
      const html = renderToStaticMarkup(tree)
      assert.doesNotMatch(html, /Start quiz|Start practice quiz|Sit the mock/)
      assert.doesNotMatch(html, new RegExp(`href="${quizHref}"`))
      const visibleText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
      assert.match(visibleText, /Practice quiz N\/A/)
      assert.match(visibleText, /Quiz time N\/A/)
      assert.match(html, new RegExp(`href="/courses/${course.slug}/materials"`))
      assert.match(visibleText, /Request material privately/)
      assert.equal((visibleText.match(/Bookmark control/g) || []).length, 1)
      assert.match(renderToStaticMarkup(await f.quizRoute(params)), /quiz is temporarily unavailable/i)
    })
  }
})

test('course navigation exposes a quiz action only when given a usable destination', async () => fixture(validQuiz, async f => {
  for (const [Component, props] of [
    [f.CourseToc, { items: [] }],
    [f.MobileCourseNav, { items: [], materialsHref: `/courses/${course.slug}/materials` }],
  ]) {
    const without = renderToStaticMarkup(React.createElement(Component, props))
    const withQuiz = renderToStaticMarkup(React.createElement(Component, { ...props, quizHref }))
    assert.doesNotMatch(without, new RegExp(`href="${quizHref}"`))
    assert.match(withQuiz, new RegExp(`href="${quizHref}"`))
  }
}))

test('homepage, course directory and bookmarks do not offer dead quiz card links', async () => {
  for (const [quiz, expected] of [[validQuiz, true], [undefined, false],
    [{ ...validQuiz, maxQuizQuestions: 0 }, false],
    [{ ...validQuiz, quizDurationMinutes: 1e308 }, false]]) {
    await fixture(quiz, async f => {
      const [homeHtml, directoryHtml, bookmarkHtml] = [f.home(), await f.directory(), f.bookmarks()]
        .map(element => renderToStaticMarkup(element))
      for (const html of [homeHtml, directoryHtml, bookmarkHtml]) {
        assert.match(html, new RegExp(`href="/courses/${course.slug}"`))
        assert.match(html, new RegExp(course.code))
        assert.match(html, new RegExp(course.title))
        assert.match(html, new RegExp(`${course.credits} credits`))
        assert.match(html, /View course/)
        if (expected) {
          assert.match(html, new RegExp(`href="${quizHref}"`))
          assert.match(html, new RegExp(`${validQuiz.questions.length} questions`))
        } else {
          assert.doesNotMatch(html, new RegExp(`href="${quizHref}"`))
          assert.doesNotMatch(html, /(?:\d+|—) questions/)
        }
      }
      const homeText = homeHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
      assert.match(homeText, new RegExp(`${expected ? '1' : '0'} Practice quizzes`))
      if (expected) {
        assert.match(homeText, /Timed quiz/)
        assert.match(homeText, new RegExp(`${validQuiz.quizDurationMinutes} min`))
      } else {
        assert.match(homeText, /Course details/)
        assert.doesNotMatch(homeText, /Notes and past papers|Timed quiz/)
      }
    })
  }
})
