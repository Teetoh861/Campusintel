const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const { getUsableCourseQuiz } = require('../../lib/data/quiz-availability.ts')
const { getCourseBySlug } = require('../../lib/data/courses.ts')
const { getQuizByCourseSlug } = require('../../lib/data/quizzes.ts')
const course = getCourseBySlug('financial-accounting-1')
const validQuiz = getQuizByCourseSlug(course.slug)
const quizHref = `/courses/${course.slug}/quiz`

async function fixture(quiz, run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const files = [
    './[slug]/page.tsx', './[slug]/quiz/page.tsx', './[slug]/CourseToc.tsx', './[slug]/MobileCourseNav.tsx',
    './page.tsx', '../page.tsx', '../bookmarks/page.tsx',
  ].map(file => require.resolve(file))
  const empty = () => null
  const bookmarkControl = () => React.createElement('button', { type: 'button' }, 'Bookmark control')
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const { Card } = require('../../components/chrome/Card.tsx')
    const renderCards = (entries) => React.createElement(React.Fragment, null,
      entries.map(({ id, cardProps }) => React.createElement(Card, { ...cardProps, key: id })))
    Module._load = function(name, ...args) {
      if (name === '@/lib/data/courses') return {
        courses: [course], getCourseBySlug: slug => slug === course.slug ? course : undefined,
      }
      if (name === '@/lib/data/quizzes') return {
        getQuizByCourseSlug: slug => slug === course.slug ? quiz : undefined,
      }
      if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') } }
      if (name === './QuizClient') return { QuizClient: function QuizClient() { return null } }
      if (name === './BookmarkButton') return { BookmarkButton: bookmarkControl }
      if (name === './CourseAccordion') return { CourseAccordion: empty }
      if (name === './CourseDirectory') return { CourseDirectory: ({ items }) => renderCards(items) }
      if (name === './BookmarksClient') return { BookmarksClient: ({ catalog }) => renderCards(catalog) }
      return originalLoad.call(this, name, ...args)
    }
    for (const file of files) delete require.cache[file]
    await run({
      detail: require(files[0]).default,
      quizRoute: require(files[1]).default,
      CourseToc: require(files[2]).CourseToc,
      MobileCourseNav: require(files[3]).MobileCourseNav,
      directory: require(files[4]).default,
      home: require(files[5]).default,
      bookmarks: require(files[6]).default,
    })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of files) delete require.cache[file]
  }
}

const params = { params: Promise.resolve({ slug: course.slug }) }

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
  assert.equal(route.props.questions, validQuiz.questions)
  assert.equal(route.props.maxQuestions, validQuiz.maxQuizQuestions)
  assert.equal(route.props.timerSeconds, validQuiz.quizDurationMinutes * 60)
  assert.equal(route.props.totalInBank, validQuiz.questions.length)
}))

test('displayed bank counts come from questions students can attempt', async () => {
  await fixture({ ...validQuiz, totalQuestions: validQuiz.questions.length + 50 }, async f => {
    const html = renderToStaticMarkup(await f.detail(params))
    assert.match(html, new RegExp(`${validQuiz.questions.length}-question bank`))
    assert.doesNotMatch(html, new RegExp(`${validQuiz.questions.length + 50}-question bank`))
    assert.equal((await f.quizRoute(params)).props.totalInBank, validQuiz.questions.length)
  })
})

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
      await assert.rejects(f.quizRoute(params), /notFound/)
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

test('homepage, public directory and bookmarks do not offer dead quiz card links', async () => {
  for (const [quiz, expected] of [[validQuiz, true], [undefined, false],
    [{ ...validQuiz, maxQuizQuestions: 0 }, false],
    [{ ...validQuiz, quizDurationMinutes: 1e308 }, false]]) {
    await fixture(quiz, async f => {
      const [homeHtml, directoryHtml, bookmarkHtml] = [f.home(), f.directory(), f.bookmarks()]
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
