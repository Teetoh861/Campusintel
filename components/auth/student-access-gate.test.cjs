// components/auth/student-access-gate.test.cjs — Student learning routes cross the server account boundary.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const realCourses = require(path.join(root, 'lib/data/courses.ts'))
const realQuizzes = require(path.join(root, 'lib/data/quizzes.ts'))
const course = realCourses.getCourseBySlug('financial-accounting-1')

const PROTECTED = [
  ['app/courses/page.tsx', () => ({}), '/courses', 'CourseDirectoryPage'],
  ['app/courses/[slug]/page.tsx', () => ({ params: Promise.resolve({ slug: course.slug }) }), `/courses/${course.slug}`, 'CourseDetail'],
  ['app/courses/[slug]/quiz/page.tsx', () => ({ params: Promise.resolve({ slug: course.slug }) }), `/courses/${course.slug}/quiz`, 'Quiz'],
  ['app/courses/[slug]/materials/page.tsx', () => ({ params: Promise.resolve({ slug: course.slug }) }), `/courses/${course.slug}/materials`, 'CourseMaterials'],
  ['app/materials/page.tsx', () => ({}), '/materials', 'MaterialsClient'],
  ['app/bookmarks/page.tsx', () => ({}), '/bookmarks', 'Bookmarks'],
]
const PUBLIC = ['app/page.tsx', 'app/login/page.tsx', 'app/register/page.tsx', 'app/confirm-email/page.tsx',
  'app/resend-confirmation/page.tsx', 'app/forgot-password/page.tsx', 'app/reset-password/page.tsx',
  'app/contact/page.tsx', 'app/tutors/page.tsx', 'app/become-a-tutor/page.tsx']

const named = name => ({ [name]: Object.defineProperty(() => null, 'name', { value: name }) })

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const originalCache = { ...require.cache }
  const state = { enabled: true, user: { id: 'student' }, sessionError: false,
    profile: { status: 'complete' }, profileReads: 0, contentReads: 0 }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return {
        redirect: to => { throw new Error('redirect:' + to) },
        notFound: () => { throw new Error('notFound') },
      }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/auth/account-continuity') return {
        issueAccountContinuityToken: (userId, sessionId) => `page:${userId}:${sessionId}`,
      }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => {
        if (state.sessionError) throw new Error('Session validation failed')
        return state.user === null ? null : { user: state.user, sessionId: 'fixture-session' }
      } }
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfile: async () => {
        state.profileReads++
        return state.profile
      } }
      if (name === '@/lib/data/courses') return { ...realCourses, getCourseBySlug: slug => {
        state.contentReads++
        return realCourses.getCourseBySlug(slug)
      } }
      if (name === '@/lib/data/quizzes') return { ...realQuizzes, getQuizByCourseSlug: slug => {
        state.contentReads++
        return realQuizzes.getQuizByCourseSlug(slug)
      } }
      if (name === '@/lib/managed-content/published') return { getPublishedManagedCourse: async () => {
        state.contentReads++
        const question = realQuizzes.getQuizByCourseSlug(course.slug).questions[0]
        return { status: 'ok', courseId: '40000000-0000-4000-8000-000000000007', content: [
          { item_id: '11111111-1111-4111-8111-111111111111', kind: 'course_overview',
            question_id: null, parent_item_id: null, revision: 1,
            payload: { title: course.title, body: course.overview } },
          { item_id: '22222222-2222-4222-8222-222222222222', kind: 'cbt_question',
            question_id: question.questionId, parent_item_id: null, revision: 1,
            payload: { prompt: question.question, options: question.options,
              correctOption: question.correctAnswer, section: question.section } },
        ] }
      } }
      if (name === '@/lib/managed-content/student-quiz') return { getStudentManagedQuiz: async () => {
        state.contentReads++
        return { status: 'ready', quiz: { questions: [], sections: [], maxQuestions: 50,
          timerSeconds: 3600, bankSize: 1 } }
      } }
      if (name === '@/components/auth/AuthShell') return named('AuthUnavailable')
      if (name === '@/components/chrome/Feedback') return named('Feedback')
      if (name === './AuthFlowSync') return named('AuthFlowSync')
      for (const client of ['QuizClient', 'BookmarkButton', 'CourseViewTracker', 'CourseAccordion',
        'CourseDirectory', 'BookmarksClient', 'MaterialsClient']) {
        if (name === './' + client) return named(client)
      }
      return originalLoad.call(this, name, ...args)
    }
    const load = file => require(path.join(root, file)).default
    // Render the real gate exactly as React would: only its returned tree is ever rendered.
    const visit = async (file, props) => {
      const gated = await load(file)(props)
      assert.equal(gated.type.name, 'StudentAccessGate')
      return { gated, result: await gated.type(gated.props) }
    }
    await run({ state, load, visit })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of Object.keys(require.cache)) if (!Object.hasOwn(originalCache, file)) delete require.cache[file]
  }
}

test('signed-out visits to every learning route redirect to login with a safe return path', async () => fixture(async f => {
  f.state.user = null
  const { getSafeReturnPath } = require(path.join(root, 'lib/auth/redirect.ts'))
  for (const [file, props, returnPath] of PROTECTED) {
    assert.equal(getSafeReturnPath(returnPath), returnPath)
    await assert.rejects(f.visit(file, props()), new RegExp('redirect:/login\\?next=' + encodeURIComponent(returnPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
  }
  assert.equal(f.state.profileReads, 0)
  assert.equal(f.state.contentReads, 0)
}))

test('a revoked session discovered at the profile read still routes through login', async () => fixture(async f => {
  f.state.profile = { status: 'signed-out' }
  for (const [file, props, returnPath] of PROTECTED) {
    await assert.rejects(f.visit(file, props()), new RegExp('redirect:/login\\?next=' + encodeURIComponent(returnPath)))
  }
  assert.equal(f.state.contentReads, 0)
}))

test('an unsafe requested slug falls back to the default safe return path', async () => fixture(async f => {
  f.state.user = null
  await assert.rejects(f.visit('app/courses/[slug]/page.tsx', { params: Promise.resolve({ slug: '..%2F%2Fevil.test' }) }),
    /redirect:\/login\?next=%2Fdashboard$/)
  assert.equal(f.state.contentReads, 0)
}))

test('signed-in students without a completed selection are sent to profile selection', async () => fixture(async f => {
  f.state.profile = { status: 'incomplete', options: {} }
  for (const [file, props] of PROTECTED) await assert.rejects(f.visit(file, props()), /redirect:\/profile-selection$/)
  assert.equal(f.state.contentReads, 0)
}))

test('session infrastructure failure, profile failure and disabled rollout fail closed', async () => fixture(async f => {
  f.state.sessionError = true
  for (const [file, props] of PROTECTED) assert.equal((await f.visit(file, props())).result.type.name, 'Feedback')
  assert.equal(f.state.profileReads, 0)
  f.state.sessionError = false
  for (const status of ['unavailable', 'missing-profile', 'invariant-failure', 'session-changed']) {
    f.state.profile = { status }
    for (const [file, props] of PROTECTED) assert.equal((await f.visit(file, props())).result.type.name, 'Feedback')
  }
  f.state.enabled = false
  const reads = f.state.profileReads
  for (const [file, props] of PROTECTED) assert.equal((await f.visit(file, props())).result.type.name, 'AuthUnavailable')
  assert.equal(f.state.profileReads, reads)
  assert.equal(f.state.contentReads, 0)
}))

test('completed students reach every existing surface with page account continuity', async () => fixture(async f => {
  for (const [file, props, , content] of PROTECTED) {
    const { result } = await f.visit(file, props())
    const [sync, child] = result.props.children
    assert.equal(sync.type.name, 'AuthFlowSync')
    assert.deepEqual(sync.props, { signedIn: true, continuityToken: 'page:student:fixture-session' })
    assert.equal(child.type.name, content)
  }
  const detail = await f.visit(PROTECTED[1][0], PROTECTED[1][1]())
  const child = detail.result.props.children[1]
  const nodes = element => !element || typeof element !== 'object' ? []
    : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
  assert.ok(nodes(await child.type(child.props)).some(node => node.type?.name === 'BookmarkButton'))
  const quiz = await f.visit(PROTECTED[2][0], PROTECTED[2][1]())
  const quizChild = quiz.result.props.children[1]
  const quizClient = await quizChild.type(quizChild.props)
  assert.equal(quizClient.type.name, 'QuizClient')
  assert.equal(quizClient.props.continuityToken, 'page:student:fixture-session')
  assert.ok(f.state.contentReads > 0)
}))

test('learning routes are per-request, never prerendered, and covered by session refresh', async () => {
  const { config } = require(path.join(root, 'proxy.ts'))
  for (const [file] of PROTECTED) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /export const dynamic = 'force-dynamic'/, file)
    assert.doesNotMatch(source, /generateStaticParams|'use client'/, file)
  }
  for (const matcher of ['/courses/:path*', '/materials', '/bookmarks', '/account/:path*', '/dashboard/:path*', '/profile-selection']) {
    assert.ok(config.matcher.includes(matcher), matcher)
  }
})

test('homepage and account-entry/recovery/support routes stay outside the learning gate', () => {
  const { config } = require(path.join(root, 'proxy.ts'))
  assert.equal(config.matcher.includes('/'), false)
  for (const file of PUBLIC) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /StudentAccessGate/, file)
  }
})
