const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MAX_PROVIDER_TIMEOUT_MS, AI_ADMISSION_TIMEOUT_MS, AI_SETTLEMENT_TIMEOUT_MS,
  AI_RESERVATION_FLOOR_MS, AiDeadlineError, withAiDeadline } = require('./lifetime.ts')

test('the database reservation floor outlasts admission, two maximum provider calls and settlement', () => {
  assert.ok(AI_RESERVATION_FLOOR_MS > AI_ADMISSION_TIMEOUT_MS + 2 * MAX_PROVIDER_TIMEOUT_MS + AI_SETTLEMENT_TIMEOUT_MS)
  assert.equal(AI_RESERVATION_FLOOR_MS, 300_000)
})

test('a provider that ignores cancellation still returns before the reservation can be abandoned', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const pending = withAiDeadline(s => { signal = s; return new Promise(() => {}) }, MAX_PROVIDER_TIMEOUT_MS)
  const rejected = assert.rejects(pending, AiDeadlineError)
  await Promise.resolve()
  t.mock.timers.tick(MAX_PROVIDER_TIMEOUT_MS - 1)
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(1)
  await rejected
  assert.equal(signal.aborted, true)
})

test('a completed operation cancels its timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  assert.equal(await withAiDeadline(s => { signal = s; return Promise.resolve('done') }, 100), 'done')
  t.mock.timers.tick(100)
  assert.equal(signal.aborted, false)
})
