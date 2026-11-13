// lib/courses/build-time-study.test.cjs — What a locked course has, read from the committed content sources.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTimeStudy } = require('./build-time-study.ts')

test('a locked course has what its committed sources publish, in all three families', () => {
  assert.deepEqual(buildTimeStudy('financial-accounting-1'), { notes: true, cbtPractice: true, theory: true })
  assert.deepEqual(buildTimeStudy('principles-business-administration'), { notes: true, cbtPractice: true, theory: false })
  assert.deepEqual(buildTimeStudy('use-of-english'), { notes: false, cbtPractice: true, theory: false })
  // An official bank course: its questions come from the bank migrations, not the repository seed.
  assert.deepEqual(buildTimeStudy('elements-banking'), { notes: false, cbtPractice: true, theory: false })
})

test('a course the sources publish nothing for has nothing to offer', () => {
  assert.deepEqual(buildTimeStudy('no-such-course'), { notes: false, cbtPractice: false, theory: false })
})
