// lib/courses/build-time-study.test.cjs — What a locked course has, read from the committed content sources: the
// repository seed, the official banks and the study-guide imports.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTimeStudy } = require('./build-time-study.ts')
const { STUDY_GUIDE_COURSES } = require('../data/study-guide-courses.ts')
const { GUIDE_IMPORTS } = require('../../scripts/managed-content/study-guides/imports.cjs')

test('a locked course has what its committed sources publish, in all three families', () => {
  assert.deepEqual(buildTimeStudy('financial-accounting-1'), { notes: true, cbtPractice: true, theory: true })
  // A seeded course with notes, no theory and no study guide (BUA 203).
  assert.deepEqual(buildTimeStudy('business-statistics'), { notes: true, cbtPractice: true, theory: false })
  // An official bank course with no study guide (INS 101): its questions come from the bank migrations, not the
  // repository seed.
  assert.deepEqual(buildTimeStudy('introduction-insurance'), { notes: false, cbtPractice: true, theory: false })
})

test('a course with an imported study guide has that guide\'s notes and theory', () => {
  // GST 111 has no notes or theory in the repository seed: both come from its guide import.
  assert.deepEqual(STUDY_GUIDE_COURSES['use-of-english'], { notes: 15, theory: 15 })
  assert.deepEqual(buildTimeStudy('use-of-english'), { notes: true, cbtPractice: true, theory: true })
  // A guide gives theory to a seeded course that had notes alone (BUA 201), and notes and theory to a bank course that
  // had neither (FIN-CM209).
  assert.deepEqual(STUDY_GUIDE_COURSES['principles-business-administration'], { notes: 10, theory: 10 })
  assert.deepEqual(buildTimeStudy('principles-business-administration'), { notes: true, cbtPractice: true, theory: true })
  assert.deepEqual(STUDY_GUIDE_COURSES['elements-banking'], { notes: 15, theory: 15 })
  assert.deepEqual(buildTimeStudy('elements-banking'), { notes: true, cbtPractice: true, theory: true })
  // A course created for its guide has notes and theory, and nothing to practise (ACC 121).
  assert.deepEqual(buildTimeStudy('introduction-cost-accounting'), { notes: true, cbtPractice: false, theory: true })
  // The generated list names exactly the imported guides' courses (scripts/managed-content/generate.cjs writes it and
  // its --check fails when an import is added without regenerating).
  assert.deepEqual(Object.keys(STUDY_GUIDE_COURSES).sort(), GUIDE_IMPORTS.map(entry => entry.contentKey).sort())
})

test('a course the sources publish nothing for has nothing to offer', () => {
  assert.deepEqual(buildTimeStudy('no-such-course'), { notes: false, cbtPractice: false, theory: false })
})
