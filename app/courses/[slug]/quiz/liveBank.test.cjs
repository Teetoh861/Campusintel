// app/courses/[slug]/quiz/liveBank.test.cjs — Fresh starts and retakes use only current validated publication.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadFreshQuiz } = require('./liveBank.ts')

const question = revision => ({ id: 1, questionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  question: `Published revision ${revision}`, options: ['A', 'B'], correctAnswer: 1,
  section: 'Section A', publishedRevision: revision })
const bank = revision => ({ status: 'ready', quiz: {
  href: '/courses/financial-accounting-1/quiz', bankSize: 1, attemptSize: 1,
  timerSeconds: 1800, maxQuestions: 50, sections: ['Section A'], questions: [question(revision)],
} })

test('each fresh load sees the current published revision; failures never use the old bank', async () => {
  const original = global.fetch
  const calls = []
  let current = 1
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify(bank(current)))
    }
    assert.equal((await loadFreshQuiz('financial-accounting-1')).questions[0].publishedRevision, 1)
    current = 2
    assert.equal((await loadFreshQuiz('financial-accounting-1')).questions[0].publishedRevision, 2)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.url === '/api/courses/financial-accounting-1/quiz-bank'
      && call.options.cache === 'no-store' && call.options.credentials === 'same-origin'))
    global.fetch = async () => new Response(JSON.stringify({ status: 'unavailable' }), { status: 503 })
    assert.equal(await loadFreshQuiz('financial-accounting-1'), null)
    global.fetch = async () => new Response(JSON.stringify({ status: 'ready', quiz: {
      ...bank(2).quiz, questions: [{ ...question(2), correctAnswer: 9 }],
    } }))
    assert.equal(await loadFreshQuiz('financial-accounting-1'), null)
  } finally { global.fetch = original }
})
