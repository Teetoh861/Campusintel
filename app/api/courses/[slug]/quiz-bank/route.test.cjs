// app/api/courses/[slug]/quiz-bank/route.test.cjs — Direct live-bank reads enforce account and profile gates.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

async function fixture(run) {
  const original = Module._load
  const file = require.resolve('./route.ts')
  const state = { profile: 'complete', quiz: { status: 'ready', quiz: {
    href: '/courses/financial-accounting-1/quiz', bankSize: 1, attemptSize: 1,
    timerSeconds: 1800, maxQuestions: 50, sections: ['A'], questions: [{
      id: 1, questionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'Published',
      options: ['A', 'B'], correctAnswer: 1, section: 'A', publishedRevision: 2,
    }],
  } }, reads: 0 }
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfile: async () => ({ status: state.profile }) }
      if (name === '@/lib/managed-content/student-quiz') return { getStudentManagedQuiz: async slug => {
        state.reads++
        assert.equal(slug, 'financial-accounting-1')
        return state.quiz
      } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { GET } = require(file)
    const read = () => GET(new Request('http://localhost/api/courses/financial-accounting-1/quiz-bank'),
      { params: Promise.resolve({ slug: 'financial-accounting-1' }) })
    await run({ state, read })
  } finally {
    Module._load = original
    delete require.cache[file]
  }
}

test('signed-out and incomplete profile cannot invoke the managed bank read', async () => fixture(async f => {
  f.state.profile = 'signed-out'
  assert.equal((await f.read()).status, 401)
  f.state.profile = 'incomplete'
  assert.equal((await f.read()).status, 403)
  f.state.profile = 'unavailable'
  assert.equal((await f.read()).status, 503)
  assert.equal(f.state.reads, 0)
}))

test('complete account sees published bank privately, and managed failure stays unavailable', async () => fixture(async f => {
  const ready = await f.read()
  assert.equal(ready.status, 200)
  assert.equal(ready.headers.get('cache-control'), 'private, no-store')
  assert.equal((await ready.json()).quiz.questions[0].publishedRevision, 2)
  f.state.quiz = { status: 'unavailable' }
  const unavailable = await f.read()
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' })
  assert.equal(f.state.reads, 2)
}))
