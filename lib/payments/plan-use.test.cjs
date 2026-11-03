// lib/payments/plan-use.test.cjs — Plan use for the refund rules: the record_plan_use call and its answers, and the
// opened-notes-topic request (live session, page continuity, the course's repository id), with the database stubbed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { planUseRecorder } = require('./plan-use.ts')

const SESSION = 'b0a1c2d3-0000-4000-8000-000000000001'
const COURSE = 'c0a1c2d3-0000-4000-8000-000000000002'
const ITEM = 'd0a1c2d3-0000-4000-8000-000000000003'

test('the recorder sends identities only; recorded and not-counted pass, refusals and errors fail', async () => {
  const calls = []
  for (const [answer, expected] of [[{ state: 'recorded' }, true], [{ state: 'not-counted' }, true],
    [{ state: 'not-allowed' }, false], [{ state: 'signed-out' }, false], [{ state: 'weird' }, false],
    [new Error('database down'), false]]) {
    const record = planUseRecorder(async (fn, args) => {
      calls.push([fn, args])
      if (answer instanceof Error) throw answer
      return answer
    })
    assert.equal(await record({ sessionId: SESSION, kind: 'theory-reveal', courseId: COURSE, ref: ITEM }), expected,
      JSON.stringify(answer instanceof Error ? 'error' : answer))
  }
  assert.deepEqual(calls[0], ['record_plan_use', { p_session_id: SESSION, p_kind: 'theory-reveal', p_course_id: COURSE,
    p_ref: ITEM }])
})

async function notesFixture(run) {
  const original = Module._load, file = require.resolve('./notes-use.ts')
  const client = {}, response = {}, uses = []
  const state = { enabled: true, context: { user: { id: 'student' }, sessionId: SESSION }, token: true,
    course: { status: 'ok', course: { repository: { repositoryCourseId: COURSE } } }, recorded: true }
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/supabase/server') return { createClient: async () => client }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => state.context }
      if (name === '@/lib/auth/account-continuity') return { matchesAccountContinuityToken: () => state.token }
      if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async (current, slug) => {
        assert.equal(current, client); assert.equal(slug, 'bua-201'); return state.course
      } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { recordNoteOpened } = require(file)
    const recordUse = async input => { uses.push(input); return state.recorded }
    const send = (input = { courseSlug: 'bua-201', itemId: ITEM }, token = 'page-token') =>
      recordNoteOpened(input, response, token, recordUse)
    await run({ state, uses, send })
  } finally { Module._load = original; delete require.cache[file] }
}

test('an opened notes topic is recorded against the course\'s repository id for this live session', async () => notesFixture(async f => {
  assert.deepEqual(await f.send(), { status: 'recorded' })
  assert.deepEqual(f.uses, [{ sessionId: SESSION, kind: 'notes-topic', courseId: COURSE, ref: ITEM }])
  f.state.course = { status: 'repository-only', course: { repository: { repositoryCourseId: COURSE } } }
  assert.deepEqual(await f.send(), { status: 'recorded' })
}))

test('signed out, another page\'s token, bad input, unknown course or a failed record write nothing or say so', async () => notesFixture(async f => {
  f.state.context = null
  assert.deepEqual(await f.send(), { status: 'signed-out' })
  f.state.context = { user: { id: 'student' }, sessionId: SESSION }
  assert.deepEqual(await f.send(undefined, null), { status: 'session-changed' })
  f.state.token = false
  assert.deepEqual(await f.send(), { status: 'session-changed' })
  f.state.token = true
  assert.deepEqual(await f.send({ courseSlug: 'BUA 201', itemId: ITEM }), { status: 'invalid-request' })
  assert.deepEqual(await f.send({ courseSlug: 'bua-201', itemId: ITEM, extra: 1 }), { status: 'invalid-request' })
  f.state.course = { status: 'not-found' }
  assert.deepEqual(await f.send(), { status: 'not-found' })
  f.state.course = { status: 'unavailable' }
  assert.deepEqual(await f.send(), { status: 'unavailable' })
  assert.deepEqual(f.uses, [])
  f.state.course = { status: 'ok', course: { repository: { repositoryCourseId: COURSE } } }
  f.state.recorded = false
  assert.deepEqual(await f.send(), { status: 'unavailable' })
  f.state.enabled = false
  assert.deepEqual(await f.send(), { status: 'unavailable' })
}))
