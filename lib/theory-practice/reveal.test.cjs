const { test } = require('node:test')
const assert = require('node:assert/strict')
const { theoryRevealer } = require('./reveal.ts')
const { rows, courseId, theoryId, feedback } = require('./fixtures.cjs')
const input = { sessionId: 'live-session', courseId, itemId: theoryId, publishedRevision: 2 }

test('one trusted reveal returns validated feedback after its atomic marker', async () => {
  const calls = []
  const reveal = theoryRevealer(async (fn, args) => { calls.push([fn, args]); return { state: 'ready', content: rows() } })
  assert.deepEqual(await reveal(input), { status: 'ready', feedback })
  assert.deepEqual(calls, [['reveal_theory_feedback', { p_session_id: 'live-session', p_course_id: courseId,
    p_item_id: theoryId, p_published_revision: 2 }]])
})

test('refused, stale, foreign and malformed replies never deliver any feedback', async () => {
  for (const state of ['signed-out', 'locked', 'content-changed']) {
    assert.deepEqual(await theoryRevealer(async () => ({ state }))(input), { status: state })
  }
  for (const content of [[], [rows()[0]], rows().map(row => ({ ...row, course_id: theoryId })),
    rows().map(row => ({ ...row, revision: 9 })), [...rows(), rows()[0]], [{ ...rows()[0], payload: {} }]]) {
    assert.deepEqual(await theoryRevealer(async () => ({ state: 'ready', content }))(input), { status: 'unavailable' })
  }
  assert.deepEqual(await theoryRevealer(async () => { throw new Error('private database details') })(input), { status: 'unavailable' })
})
