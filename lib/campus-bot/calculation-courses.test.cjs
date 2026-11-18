// lib/campus-bot/calculation-courses.test.cjs — The first list of calculation courses (whose explanations are checked
// by the stronger model) is every course whose exam runs 40 minutes in the exam configuration, the owner's rule for
// banks with calculation questions (scripts/managed-content/official-banks/decisions.cjs). The migration seeds the
// list by content key; this holds the two together on the day they were written. The team changes the flag afterwards
// with `campus-bot-course`, so a later change to an exam's length is a prompt to review this list, not a rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { courses } = require('../data/courses.ts')
const { OFFICIAL_BANK_COURSES, OFFICIAL_BANK_QUIZZES } = require('../data/official-bank-courses.ts')
const { getQuizConfigurationByCourseSlug, quizzes } = require('../data/quizzes.ts')

const CALCULATION_MINUTES = 40
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261117100000_campus_bot_explain_ask.sql'), 'utf8')

function seeded() {
  const statement = /insert into private\.campus_bot_courses[\s\S]*?where c\.content_key in \(([\s\S]*?)\);/.exec(migration)
  assert.ok(statement, 'the migration seeds private.campus_bot_courses by content key')
  return [...statement[1].matchAll(/'([a-z0-9-]+)'/g)].map(match => match[1]).sort()
}

test('the migration flags exactly the courses whose exam runs 40 minutes', () => {
  const everyCourse = [...courses, ...OFFICIAL_BANK_COURSES]
  const slugs = [...new Set([...Object.keys(quizzes), ...Object.keys(OFFICIAL_BANK_QUIZZES)])]
  const expected = slugs.filter(slug => getQuizConfigurationByCourseSlug(slug).quizDurationMinutes === CALCULATION_MINUTES)
    .map(slug => {
      const course = everyCourse.find(entry => entry.slug === slug)
      assert.ok(course, `${slug} is a course`)
      return course.contentKey
    }).sort()
  assert.deepEqual(seeded(), expected)
  assert.equal(expected.length, 16)
})

test('the list by course code, as reported to the owner', () => {
  const codes = seeded().map(key => getQuizConfigurationByCourseSlug(key).courseCode).sort()
  assert.deepEqual(codes, ['ACC101', 'ACS101', 'AMS103', 'BUA203', 'BUA205', 'ECO101', 'ECO201', 'FIN-CM209', 'FIN101',
    'FIN216', 'INS101', 'LAG-ACS209', 'LAG-ACS213', 'LAG-BUA111', 'LAG-BUA125', 'TAX-CM223'])
})
