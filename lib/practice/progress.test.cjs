// lib/practice/progress.test.cjs — Home's practice summary (owner's sprint plan of 23 Oct, item 2): one read keyed by the
// verified session; every database answer maps to explicit figures or to `unavailable`, never to guessed ones.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { practiceProgressFrom, readPracticeProgress } = require('./progress.ts')

const NOW = '2026-10-27T09:00:00.000Z'
const COURSE = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ok = extra => ({ state: 'ok', now: NOW, open: null, latest: null, courses: [], ...extra })

test('sprint plan 23 Oct item 2: day one is no open attempt, no latest course and no per-course figures', () => {
  assert.deepEqual(practiceProgressFrom(ok()), { status: 'ok', now: NOW, open: null, latest: null, courses: new Map() })
})

test('sprint plan 23 Oct item 2: open, latest and several courses map to the student\'s own figures', () => {
  const result = practiceProgressFrom(ok({
    open: { course_id: COURSE(2), content_key: 'business-law', deadline_at: '2026-10-27T09:12:00.000Z', mode: 'exam' },
    latest: { course_id: COURSE(1), content_key: 'financial-accounting-1' },
    courses: [{ course_id: COURSE(1), practised: 10, score: 6, total: 10 },
      { course_id: COURSE(2), practised: 5, score: 4, total: 5 }],
  }))
  assert.deepEqual(result, { status: 'ok', now: NOW,
    open: { courseId: COURSE(2), contentKey: 'business-law', deadlineAt: '2026-10-27T09:12:00.000Z', mode: 'exam' },
    latest: { courseId: COURSE(1), contentKey: 'financial-accounting-1' },
    courses: new Map([[COURSE(1), { practised: 10, lastScore: { score: 6, total: 10 } }],
      [COURSE(2), { practised: 5, lastScore: { score: 4, total: 5 } }]]) })
  assert.deepEqual(practiceProgressFrom({ state: 'signed-out' }), { status: 'signed-out' })
})

test('instant feedback: picks count straight away, and a course practised only in an open attempt has no score yet', () => {
  const result = practiceProgressFrom(ok({
    open: { course_id: COURSE(3), content_key: 'use-of-english', deadline_at: '2026-10-27T12:00:00.000Z', mode: 'instant' },
    courses: [{ course_id: COURSE(3), practised: 2, score: null, total: null }] }))
  assert.equal(result.open.mode, 'instant')
  assert.deepEqual(result.courses.get(COURSE(3)), { practised: 2, lastScore: null })
})

test('sprint plan 23 Oct item 2: a malformed or contradictory answer shows no figures at all', () => {
  const course = { course_id: COURSE(1), practised: 1, score: 1, total: 2 }
  for (const [name, data] of [
    ['nothing', null], ['unknown state', { state: 'open' }], ['missing courses', { state: 'ok', now: NOW, open: null, latest: null }],
    ['extra field', ok({ answers: {} })], ['question payload', ok({ courses: [{ ...course, questions: [] }] })],
    ['negative count', ok({ courses: [{ ...course, practised: -1 }] })],
    ['score above its total', ok({ courses: [{ ...course, score: 3 }] })],
    ['score without a total', ok({ courses: [{ ...course, total: null }] })],
    ['a total without a score', ok({ courses: [{ ...course, score: null }] })],
    ['an open attempt with no mode', ok({ open: { course_id: COURSE(1), content_key: 'x', deadline_at: NOW } })],
    ['duplicate course', ok({ courses: [course, course] })],
    ['bad course id', ok({ latest: { course_id: 'BUA201', content_key: 'x' } })],
  ]) assert.deepEqual(practiceProgressFrom(data), { status: 'unavailable' }, name)
})

test('sprint plan 23 Oct item 2: one call per page, and a failed call is unavailable', async () => {
  let calls = 0
  const env = answer => ({ progress: async () => { calls += 1; return answer() } })
  assert.equal((await readPracticeProgress('session', env(() => ({ data: ok(), error: null })))).status, 'ok')
  assert.equal(calls, 1)
  assert.deepEqual(await readPracticeProgress('session', env(() => ({ data: ok(), error: { code: '42501' } }))),
    { status: 'unavailable' })
  assert.deepEqual(await readPracticeProgress('session', env(() => { throw Error('network') })), { status: 'unavailable' })
})
