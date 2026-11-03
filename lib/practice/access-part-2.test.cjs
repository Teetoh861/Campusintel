const { test } = require('node:test')
const assert = require('node:assert/strict')
const { discoveryResultFrom } = require('../entitlements/discovery.ts')
const { practiceResultFrom } = require('./server.ts')
const ID = 'a4220000-0000-4000-8000-000000000001'
const now = '2026-11-01T12:00:00Z'
const score = { state: 'ready', now, ends_at: now, preview: { kind: 'cbt', deadline_at: now,
  questions: [], saved: null, result: { score: 1, total: 50, timed_out: false } } }

test('Discovery score-only response parses; any answer key or explanation fails closed', () => {
  assert.equal(discoveryResultFrom(score).status, 'ready')
  const leaked = structuredClone(score)
  leaked.preview.result.answers = [{ correct_option: 1, explanation: 'never send this' }]
  assert.equal(discoveryResultFrom(leaked).status, 'unavailable')
})

test('expired ordinary result preserves score and exposes no review, across the API mapper', () => {
  const result = practiceResultFrom({ state: 'graded', now, attempt: { id: ID, course_id: ID, mode: 'exam', topic: null,
    status: 'submitted', intent: 'new', redo_of: null, started_at: now, deadline_at: now, duration_seconds: 300,
    question_count: 1, bank_size: 10, questions: [], saved: null, review_available: false,
    result: { score: 0, total: 1, timed_out: false, finished_at: now } } })
  assert.equal(result.status, 'graded')
  assert.equal(result.attempt.reviewAvailable, false)
  assert.deepEqual(result.attempt.questions, [])
  assert.equal(result.attempt.result.score, 0)
})

for (const reason of ['needs-plan', 'outside-list', 'needs-selection']) test(`API retains the score-only reason: ${reason}`, () => {
  const result = practiceResultFrom({ state: 'graded', now, attempt: { id: ID, course_id: ID, mode: 'exam', topic: null,
    status: 'submitted', intent: 'new', redo_of: null, started_at: now, deadline_at: now, duration_seconds: 300,
    question_count: 1, bank_size: 10, questions: [], saved: null, review_available: false, can_start_new: false, review_unavailable_reason: reason,
    result: { score: 0, total: 1, timed_out: false, finished_at: now } } })
  assert.equal(result.status, 'graded')
  assert.equal(result.attempt.reviewUnavailableReason, reason)
  assert.equal(result.attempt.canStartNew, false)
  assert.deepEqual(result.attempt.questions, [])
})
