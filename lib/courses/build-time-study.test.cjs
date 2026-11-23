// lib/courses/build-time-study.test.cjs — What a locked course has, read from the generated published state
// (lib/data/published-study.ts): the repository seed, the official banks, the study-guide imports and the owner content
// rule, as the migrations leave them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildTimeStudy } = require('./build-time-study.ts')
const { PUBLISHED_STUDY } = require('../data/published-study.ts')

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')

test('a locked course has what it publishes after every migration, in all three families', () => {
  // A guide course with an official bank (ACC-CM201): the guide's notes and the bank's questions. The owner content rule
  // withdrew every theory question.
  assert.deepEqual(PUBLISHED_STUDY['financial-accounting-1'], { notes: 8, cbt: 503, theory: 0 })
  assert.deepEqual(buildTimeStudy('financial-accounting-1'), { notes: true, cbtPractice: true, theory: false })
  // An official bank course with no study guide (INS 101).
  assert.deepEqual(buildTimeStudy('introduction-insurance'), { notes: false, cbtPractice: true, theory: false })
  // A course created for its guide has notes, and nothing to practise (ACC 121).
  assert.deepEqual(buildTimeStudy('introduction-cost-accounting'), { notes: true, cbtPractice: false, theory: false })
})

test('a course the owner content rule emptied offers nothing it no longer publishes', () => {
  // BUA 203, LAG-BUA210 and BUA 221: their notes and practice questions are withdrawn, so nothing is left.
  for (const slug of ['business-statistics', 'business-mathematics', 'consumer-behaviour']) {
    assert.deepEqual(PUBLISHED_STUDY[slug], { notes: 0, cbt: 0, theory: 0 }, slug)
    assert.deepEqual(buildTimeStudy(slug), { notes: false, cbtPractice: false, theory: false }, slug)
  }
  // GST 112 and BUA 222 keep only their overview: no practice, though their quiz settings remain in the repository.
  for (const slug of ['nigerian-peoples-and-culture', 'international-organisational-behaviour']) {
    assert.deepEqual(buildTimeStudy(slug), { notes: false, cbtPractice: false, theory: false }, slug)
  }
  // No course publishes theory any more.
  assert.deepEqual(Object.entries(PUBLISHED_STUDY).filter(([, row]) => row.theory > 0), [])
})

test('a course with an imported study guide has its notes', () => {
  // Every imported guide's course is listed with its notes, among all 35 courses (scripts/managed-content/generate.cjs
  // writes the module and its --check fails when it is stale).
  const { GUIDE_IMPORTS } = require('../../scripts/managed-content/study-guides/imports.cjs')
  assert.equal(Object.keys(PUBLISHED_STUDY).length, 35)
  for (const entry of GUIDE_IMPORTS) assert.ok(PUBLISHED_STUDY[entry.contentKey].notes > 0, entry.code)
  assert.deepEqual(PUBLISHED_STUDY['use-of-english'], { notes: 15, cbt: 650, theory: 0 })
  assert.deepEqual(buildTimeStudy('use-of-english'), { notes: true, cbtPractice: true, theory: false })
  assert.deepEqual(buildTimeStudy('principles-business-administration'), { notes: true, cbtPractice: true, theory: false })
  assert.deepEqual(buildTimeStudy('elements-banking'), { notes: true, cbtPractice: true, theory: false })
})

test('only the generated published state is read', () => {
  const source = read('build-time-study.ts')
  assert.match(source, /from '@\/lib\/data\/published-study'/)
  assert.doesNotMatch(source, /topic-notes|theory-questions|study-guide-courses|STUDY_GUIDE_COURSES/)
  // The study guide module no longer lists what each guide publishes: published-study.ts does, for every course.
  assert.doesNotMatch(read('../data/study-guide-courses.ts'), /STUDY_GUIDE_COURSES\b/)
})

test('a course the sources publish nothing for has nothing to offer', () => {
  assert.deepEqual(buildTimeStudy('no-such-course'), { notes: false, cbtPractice: false, theory: false })
  assert.equal(Object.hasOwn(PUBLISHED_STUDY, 'toString'), false)
  assert.deepEqual(buildTimeStudy('toString'), { notes: false, cbtPractice: false, theory: false })
})
