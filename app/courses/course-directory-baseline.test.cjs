// app/courses/course-directory-baseline.test.cjs — Current-contract coverage for the gated course directory.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const repositoryCourse = {
  id: 'built-id', contentKey: 'public-built', slug: 'public-built', code: 'BUA999',
  title: 'Public built course', overview: 'Stale repository overview',
  level: 200, semester: 1, credits: 2, difficulty: 'Easy', examCritical: true,
}
const publishedRows = [{
  item_id: '11111111-1111-4111-8111-111111111111',
  course_id: '22222222-2222-4222-8222-222222222222',
  kind: 'course_overview', question_id: null, source_key: null,
  parent_item_id: null, revision: 1,
  payload: { title: 'Published title', body: 'Published overview' },
}]
const managedQuestions = [{ questionId: '33333333-3333-4333-8333-333333333333',
  question: 'Published question', options: ['A', 'B'], correctAnswer: 0,
  section: 'General', publishedRevision: 2 }]
const quizConfig = { courseSlug: repositoryCourse.slug, maxQuizQuestions: 2,
  quizDurationMinutes: 25, sections: ['General'] }
const usableQuiz = { href: '/courses/public-built/quiz', bankSize: 3, timerSeconds: 1500 }

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

async function fixture(run, catalog = [repositoryCourse]) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const file = require.resolve('./page.tsx')
  const calls = { reads: [], projections: [], configs: [], quizzes: [] }
  const state = {
    published: new Map(catalog.map(course => [course.contentKey,
      { status: 'ok', content: publishedRows }])),
    projection: { status: 'ok', learning: { overview: { body: 'Published overview' },
      theoryQuestions: [], quizQuestions: managedQuestions } },
    quiz: usableQuiz,
  }
  function StudentAccessGate() { return null }
  function CourseDirectory() { return null }
  function Feedback() { return null }
  try {
    Module._extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(
      fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      } }).outputText, filename)
    Module._load = function(name, ...args) {
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
      if (name === '@/components/chrome/Feedback') return { Feedback }
      if (name === '@/lib/data/courses') return { courses: catalog }
      if (name === '@/lib/data/quizzes') return { getQuizConfigurationByCourseSlug: slug => {
        calls.configs.push(slug)
        return quizConfig
      } }
      if (name === '@/lib/managed-content/published') return { getPublishedManagedCourse: async key => {
        calls.reads.push(key)
        return state.published.get(key)
      } }
      if (name === '@/lib/managed-content/student-projection') return { projectStudentLearning: rows => {
        calls.projections.push(rows)
        return state.projection
      } }
      if (name === '@/lib/managed-content/quiz') return { getUsableManagedQuiz: (...args) => {
        calls.quizzes.push(args)
        return state.quiz
      } }
      if (name === './CourseDirectory') return { CourseDirectory }
      return originalLoad.call(this, name, ...args)
    }
    delete require.cache[file]
    const gated = require(file).default()
    assert.equal(gated.type, StudentAccessGate)
    assert.equal(gated.props.returnPath, '/courses')
    const child = gated.props.children
    const renderGranted = () => child.type(child.props)
    await run({ calls, state, renderGranted, CourseDirectory, Feedback })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
}

test('gated /courses builds cards from published learning and current quiz policy', async () => fixture(async f => {
  const pending = f.renderGranted()
  assert.ok(pending instanceof Promise, 'the directory child resolves asynchronously')
  const directory = nodes(await pending).find(node => node.type === f.CourseDirectory)
  assert.ok(directory)
  assert.equal(directory.props.totalCount, 1)
  const [item] = directory.props.items
  assert.equal(item.id, repositoryCourse.id)
  assert.deepEqual(item.filter, { code: repositoryCourse.code, title: repositoryCourse.title,
    level: 200, semester: 1, difficulty: 'Easy' })
  assert.equal(item.cardProps.cta.href, '/courses/public-built')
  assert.equal(item.cardProps.title, repositoryCourse.title)
  assert.equal(item.cardProps.desc, 'Published overview')
  assert.notEqual(item.cardProps.desc, repositoryCourse.overview)
  assert.equal(item.cardProps.questions, '3')
  assert.equal(item.cardProps.timeLimit, '25 min')
  assert.equal(item.cardProps.secondaryCta.href, usableQuiz.href)
  assert.deepEqual(f.calls.reads, [repositoryCourse.contentKey])
  assert.deepEqual(f.calls.projections, [publishedRows])
  assert.deepEqual(f.calls.configs, [repositoryCourse.slug])
  assert.deepEqual(f.calls.quizzes, [[repositoryCourse.slug, quizConfig, managedQuestions]])

  f.state.projection = { status: 'ok', learning: { overview: null,
    theoryQuestions: [], quizQuestions: managedQuestions } }
  const withoutOverview = nodes(await f.renderGranted()).find(node => node.type === f.CourseDirectory)
  assert.equal(withoutOverview.props.items[0].cardProps.desc, undefined,
    'missing published overview must not fall back to repository learning text')
}))

test('unavailable publication or projection fails closed without repository learning fallback', async () => {
  const second = { ...repositoryCourse, id: 'second-id', contentKey: 'second-built',
    slug: 'second-built', code: 'BUA998' }
  await fixture(async f => {
    f.state.published.set(second.contentKey, { status: 'unavailable' })
    let result = await f.renderGranted()
    assert.equal(result.type, f.Feedback)
    assert.equal(result.props.message, 'Course content is temporarily unavailable.')
    assert.equal(result.props.tone, 'error')
    assert.equal(nodes(result).some(node => node.type === f.CourseDirectory), false)
    assert.deepEqual(f.calls.reads, [repositoryCourse.contentKey, second.contentKey])
    assert.deepEqual(f.calls.quizzes, [], 'a partial catalogue cannot offer quiz links')

    f.state.published.set(second.contentKey, { status: 'ok', content: publishedRows })
    f.state.projection = { status: 'unavailable' }
    result = await f.renderGranted()
    assert.equal(result.type, f.Feedback)
    assert.equal(nodes(result).some(node => node.type === f.CourseDirectory), false)
    assert.deepEqual(f.calls.quizzes, [])
  }, [repositoryCourse, second])
})
