// lib/profile/course-selection.test.cjs — The lock read the pages decide on: only the database's own shape is believed,
// the date is only kept while locked, and a Lagos calendar day reads as students write it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { formatSemesterDay, readCourseSelection, readProfileRevision } = require('./course-selection.ts')

const client = (data, error = null) => ({ rpc: async name => (assert.equal(name, 'get_my_course_selection'), { data, error }) })

test('locked, with the reason dropped and the last day kept', async () => {
  assert.deepEqual(await readCourseSelection(client({ state: 'locked', locked: true, reason: 'early-access',
    last_day: '2027-03-08' })), { state: 'locked', locked: true, lastDay: '2027-03-08' })
  assert.deepEqual(await readCourseSelection(client({ state: 'locked', locked: true, reason: 'paid', last_day: null })),
    { state: 'locked', locked: true, lastDay: null })
})

test('open, incomplete and reselect carry no date and are never locked', async () => {
  for (const state of ['open', 'incomplete', 'reselect']) {
    assert.deepEqual(await readCourseSelection(client({ state, locked: false, reason: null, last_day: null })),
      { state, locked: false, lastDay: null })
  }
  assert.deepEqual(await readCourseSelection(client({ state: 'open', locked: true, reason: null, last_day: '2027-03-08' })),
    { state: 'open', locked: false, lastDay: '2027-03-08' }, 'locked only when the state says so')
})

test('an error, a malformed answer or a throw reads as unknown (null), never as unlocked', async () => {
  assert.equal(await readCourseSelection(client(null, { code: '42501' })), null)
  assert.equal(await readCourseSelection(client({ state: 'frozen', locked: true, last_day: null })), null)
  assert.equal(await readCourseSelection(client({ state: 'locked', locked: true, last_day: '8 March' })), null)
  assert.equal(await readCourseSelection({ rpc: async () => { throw new Error('network') } }), null)
})

test('the profile revision is read for the signed-in student only and validated', async () => {
  const filters = []
  const from = data => ({ from: table => (assert.equal(table, 'profiles'), { select: columns => (assert.equal(columns, 'revision'), {
    eq: (column, value) => (filters.push([column, value]), { maybeSingle: async () => ({ data, error: null }) }) }) }) })
  assert.equal(await readProfileRevision(from({ revision: 7 }), 'student-1'), 7)
  assert.deepEqual(filters, [['id', 'student-1']])
  assert.equal(await readProfileRevision(from({ revision: -1 }), 'student-1'), null)
  assert.equal(await readProfileRevision(from(null), 'student-1'), null)
})

test('a semester day reads as "8 March 2027"; anything else is empty', () => {
  assert.equal(formatSemesterDay('2027-03-08'), '8 March 2027')
  assert.equal(formatSemesterDay('2026-11-30'), '30 November 2026')
  assert.equal(formatSemesterDay('2027-13-01'), '')
  assert.equal(formatSemesterDay('2027-3-8'), '')
})
