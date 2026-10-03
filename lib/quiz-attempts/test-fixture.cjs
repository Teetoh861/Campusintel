// Load with the repository's documented lib/auth/test-loader.cjs preloader.
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const originalLoad = Module._load
  const savedCache = new Map(Object.entries(require.cache))
  const previousSecret = process.env.SUPABASE_SECRET_KEY
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_' + 'test-only-'.repeat(8)
  const id = { user: randomUUID(), otherUser: randomUUID(), session: randomUUID(),
    otherSession: randomUUID(), attempt: randomUUID(), course: randomUUID() }
  const calls = []
  const state = { enabled: true, user: id.user, session: id.session,
    signedOut: false, authFailure: false, bridgeFailure: false, bridgeMissing: false,
    bridgeMismatch: false, publishedFailure: false, rpcFailure: false, rpcResult: null, onBridge: null }
  const course = require('../data/courses.ts').getCourseByContentKey('financial-accounting-1')
  const quiz = require('../data/quizzes.ts').getQuizByCourseSlug(course.slug)
  const managedQuestions = quiz.questions.slice(0, quiz.maxQuizQuestions)
  const publishedRows = managedQuestions.map((question, ordinal) => ({
    item_id: randomUUID(), course_id: id.course, kind: 'cbt_question',
    question_id: question.questionId, source_key: null, parent_item_id: null,
    revision: 1, payload: { prompt: question.question, options: question.options,
      correctOption: question.correctAnswer, section: question.section,
      ...(question.explanation ? { explanation: question.explanation } : {}) },
    ordinal,
  }))
  const client = {
    auth: {
      getUser: async () => {
        calls.push(['getUser'])
        return state.authFailure ? { data: { user: null }, error: { message: 'private failure' } }
          : state.signedOut ? { data: { user: null }, error: { code: 'session_expired' } }
          : { data: { user: { id: state.user } }, error: null }
      },
      getClaims: async () => {
        calls.push(['getClaims'])
        return { data: { claims: { sub: state.user, session_id: state.session } }, error: null }
      },
    },
    from: table => {
      calls.push(['from', table])
      assert.equal(table, 'courses')
      return { select: columns => {
        assert.equal(columns, 'id,content_key')
        return { eq: (field, key) => {
          calls.push(['bridge', field, key])
          assert.equal(field, 'content_key')
          return { maybeSingle: async () => {
            if (state.onBridge) state.onBridge()
            return { error: state.bridgeFailure ? { message: 'private failure' } : null,
              data: state.bridgeMissing ? null : { id: id.course,
                content_key: state.bridgeMismatch ? 'wrong-bridge' : key } }
          } }
        } }
      } }
    },
  }
  const mocks = {
    '@/lib/auth/config': { isStudentAuthEnabled: () => state.enabled,
      getAuthOrigin: () => 'http://localhost:3000',
      getAuthSecretKey: () => process.env.SUPABASE_SECRET_KEY },
    '@/lib/supabase/server': { createClient: async response => {
      calls.push(['createClient'])
      if (response) response.cookies.set('sb-fixture', 'rotated', { httpOnly: true })
      return client
    } },
    '@/lib/quiz-attempts/rpc': { writeAttemptCommand: async command => {
      calls.push(['rpc', command])
      if (state.rpcFailure) throw new Error('private store error')
      return state.rpcResult || { status: 'saved', attempt: {
        id: command.p_attempt_id, questionCount: command.p_question_count,
        status: command.p_status, revision: command.p_expected_revision === null ? 0 : command.p_expected_revision + 1,
      } }
    } },
    '@/lib/managed-content/published': { getPublishedManagedCourse: async key => {
      calls.push(['published', key])
      return state.publishedFailure ? { status: 'unavailable' }
        : { status: 'ok', courseId: id.course, content: publishedRows }
    } },
  }
  try {
    Module._load = function (name, ...args) {
      if (name === './rpc' && args[0]?.filename === require.resolve('./current-student-attempt.ts')) {
        return mocks['@/lib/quiz-attempts/rpc']
      }
      return mocks[name] || originalLoad.call(this, name, ...args)
    }
    const fresh = file => { delete require.cache[require.resolve(file)]; return require(file) }
    fresh('../auth/student-state.ts')
    fresh('../auth/account-continuity.ts')
    const domain = fresh('./current-student-attempt.ts')
    const route = fresh('../../app/api/quiz-attempts/route.ts')
    const token = () => require('../auth/account-continuity.ts').issueAccountContinuityToken(state.user, state.session)
    const start = () => ({ operation: 'start', attemptId: id.attempt, courseContentKey: course.contentKey,
      questions: managedQuestions.map((question, ordinal) => ({
        questionId: question.questionId, ordinal, publishedRevision: 1,
      })) })
    const answer = (question = quiz.questions[0], ordinal = 0, optionIndex = question.correctAnswer) => ({
      questionId: question.questionId, ordinal, optionIndex,
    })
    const record = () => ({ operation: 'record', attemptId: id.attempt,
      courseContentKey: course.contentKey, expectedRevision: 0, answers: [answer()] })
    const post = async (body, pageToken = token(), extraHeaders = {}) => {
      const response = await route.POST(new Request('http://localhost:3000/api/quiz-attempts', {
        method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
          ...(pageToken === null ? {} : { 'x-campus-account-continuity': pageToken }), ...extraHeaders },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }))
      return { response, body: await response.json() }
    }
    await run({ id, calls, state, domain, route, course, quiz, managedQuestions,
      publishedRows, token, start, answer, record, post })
  } finally {
    Module._load = originalLoad
    for (const key of Object.keys(require.cache)) if (!savedCache.has(key)) delete require.cache[key]
    for (const [key, entry] of savedCache) require.cache[key] = entry
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY
    else process.env.SUPABASE_SECRET_KEY = previousSecret
  }
}

module.exports = { fixture }
