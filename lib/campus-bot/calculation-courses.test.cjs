// lib/campus-bot/calculation-courses.test.cjs — The first list of calculation courses (whose explanations are checked
// by the stronger model) is every course whose exam runs 40 minutes in the exam configuration, the owner's rule for
// banks with calculation questions (scripts/managed-content/official-banks/decisions.cjs). The migration seeds the
// list by content key; this holds the two together on the day they were written. The team changes the flag afterwards
// with `campus-bot-course`, so a later change to an exam's length is a prompt to review this list, not a rule.
// LAG-BUA210's exam became 40 minutes when it took the LAG-ACS213 bank (owner, 25 Nov 2026), and its migration flags it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { courses } = require('../data/courses.ts')
const { OFFICIAL_BANK_COURSES, OFFICIAL_BANK_QUIZZES } = require('../data/official-bank-courses.ts')
const { getQuizConfigurationByCourseSlug, quizzes } = require('../data/quizzes.ts')

const CALCULATION_MINUTES = 40
const MIGRATIONS = path.join(__dirname, '../../supabase/migrations')
const migration = fs.readFileSync(path.join(MIGRATIONS, '20261117100000_campus_bot_explain_ask.sql'), 'utf8')
const LAG_BUA210 = fs.readFileSync(path.join(MIGRATIONS, '20261125100400_campus_bot_calculation_lag_bua210.sql'), 'utf8')

function seeded() {
  const statement = /insert into private\.campus_bot_courses[\s\S]*?where c\.content_key in \(([\s\S]*?)\);/.exec(migration)
  assert.ok(statement, 'the migration seeds private.campus_bot_courses by content key')
  return [...statement[1].matchAll(/'([a-z0-9-]+)'/g)].map(match => match[1]).sort()
}

/** The seeded list and the course LAG-BUA210's migration adds. */
function flagged() {
  const added = /insert into private\.campus_bot_courses[\s\S]*?where content_key = '([a-z0-9-]+)'/.exec(LAG_BUA210)
  assert.ok(added && /on conflict \(course_id\) do update set calculation = true/.test(LAG_BUA210), 'LAG-BUA210 is flagged')
  return [...seeded(), added[1]].sort()
}

test('the migrations flag exactly the courses whose exam runs 40 minutes', () => {
  const everyCourse = [...courses, ...OFFICIAL_BANK_COURSES]
  const slugs = [...new Set([...Object.keys(quizzes), ...Object.keys(OFFICIAL_BANK_QUIZZES)])]
  const expected = slugs.filter(slug => getQuizConfigurationByCourseSlug(slug).quizDurationMinutes === CALCULATION_MINUTES)
    .map(slug => {
      const course = everyCourse.find(entry => entry.slug === slug)
      assert.ok(course, `${slug} is a course`)
      return course.contentKey
    }).sort()
  assert.deepEqual(flagged(), expected)
  assert.equal(expected.length, 17)
})

test('the list by course code, as reported to the owner', () => {
  // The exam configuration's codes; LAG-BUA210's is BUA210 there.
  const codes = flagged().map(key => getQuizConfigurationByCourseSlug(key).courseCode).sort()
  assert.deepEqual(codes, ['ACC101', 'ACS101', 'AMS103', 'BUA203', 'BUA205', 'BUA210', 'ECO101', 'ECO201', 'FIN-CM209', 'FIN101',
    'FIN216', 'INS101', 'LAG-ACS209', 'LAG-ACS213', 'LAG-BUA111', 'LAG-BUA125', 'TAX-CM223'])
})

test('BUA203 and LAG-BUA210 have their sources\' exams: 50 questions in 40 minutes, on the source bank\'s topics', () => {
  for (const [copy, source] of [['business-statistics', 'business-statistics-1'], ['business-mathematics', 'mathematics-business']]) {
    const own = getQuizConfigurationByCourseSlug(copy), theirs = getQuizConfigurationByCourseSlug(source)
    assert.deepEqual([own.maxQuizQuestions, own.quizDurationMinutes], [50, 40], copy)
    assert.deepEqual([theirs.maxQuizQuestions, theirs.quizDurationMinutes], [50, 40], source)
    assert.deepEqual(own.sections, theirs.sections, `${copy}: the topics of ${source}'s bank`)
  }
})
