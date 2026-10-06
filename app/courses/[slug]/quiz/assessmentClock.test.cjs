const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAssessmentClock } = require('./assessmentClock.ts')

test('the deadline begins only on Start and a delayed callback catches up', () => {
  let now = 100_000
  const clock = createAssessmentClock(() => now)
  now += 20_000
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: false })
  clock.start(60)
  now += 25_000
  assert.deepEqual(clock.read(), { secondsLeft: 35, expiredNow: false })
  now += 34_500
  assert.deepEqual(clock.read(), { secondsLeft: 1, expiredNow: false })
})

test('a suspended tab catches up past expiry and reports timeout once', () => {
  let now = 0
  const clock = createAssessmentClock(() => now)
  clock.start(30)
  now = 45_000
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: true })
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: false })
  clock.stop()
  assert.deepEqual(clock.read(), { secondsLeft: 30, expiredNow: false })
})

test('a redo or retake starts a fresh deadline', () => {
  let now = 0
  const clock = createAssessmentClock(() => now)
  clock.start(10)
  now = 10_000
  assert.equal(clock.read().expiredNow, true)
  clock.stop()
  now = 25_000
  clock.start(10)
  assert.deepEqual(clock.read(), { secondsLeft: 10, expiredNow: false })
  now = 34_999
  assert.deepEqual(clock.read(), { secondsLeft: 1, expiredNow: false })
  now = 35_000
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: true })
})

test('each attempt supplies its duration and replaces the previous deadline', () => {
  let now = 0
  const clock = createAssessmentClock(() => now)
  clock.start(3600)
  now = 60_000
  assert.deepEqual(clock.read(), { secondsLeft: 3540, expiredNow: false })
  clock.stop()
  now = 500_000
  clock.start(2700)
  assert.deepEqual(clock.read(), { secondsLeft: 2700, expiredNow: false })
  now += 2_700_000 - 1
  assert.deepEqual(clock.read(), { secondsLeft: 1, expiredNow: false })
  now += 1
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: true })
  assert.deepEqual(clock.read(), { secondsLeft: 0, expiredNow: false })
  clock.stop()
  assert.deepEqual(clock.read(), { secondsLeft: 2700, expiredNow: false })
  clock.start(1800)
  assert.deepEqual(clock.read(), { secondsLeft: 1800, expiredNow: false })
})
