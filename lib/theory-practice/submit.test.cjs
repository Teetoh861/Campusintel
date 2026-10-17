const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { feedback, question, slug, command, longDraft } = require('./fixtures.cjs')

async function fixture(run) {
  const original = Module._load, file = require.resolve('./submit.ts')
  const client = {}, response = {}, calls = [], events = []
  const context = { user: { id: 'live-student' }, sessionId: 'live-session' }
  const state = { enabled: true, first: context, second: context, token: true, profile: 'complete',
    published: { status: 'ready', course: { slug }, materials: [{ question, feedback }] }, error: false }
  let checks = 0
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/supabase/server') return { createClient: async supplied => {
        assert.equal(supplied, response); calls.push('client'); return client
      } }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (supplied, current) => {
        assert.equal(supplied, response); assert.equal(current, client); calls.push('session')
        if (state.error) throw new Error('private upstream failure')
        return ++checks === 1 ? state.first : state.second
      } }
      if (name === '@/lib/auth/account-continuity') return { matchesAccountContinuityToken: (token, id, session) => {
        assert.equal(token, 'page-token'); assert.equal(id, context.user.id); assert.equal(session, context.sessionId)
        calls.push('continuity'); return state.token
      } }
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfileForVerifiedStudent: async (current, user) => {
        assert.equal(current, client); assert.equal(user, context.user); calls.push('profile'); return { status: state.profile }
      } }
      if (name === './published') return { getTheoryPracticeForVerifiedStudent: async (current, requested) => {
        assert.equal(current, client); assert.equal(requested, slug); calls.push('publication'); return state.published
      } }
      if (name === './events') return { recordTheorySubmission: async (...event) => events.push(event) }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { submitTheoryAnswer } = require(file)
    const submit = (input = command(), token = 'page-token') => { checks = 0; return submitTheoryAnswer(input, response, token) }
    await run({ state, calls, events, context, submit })
  } finally { Module._load = original; delete require.cache[file] }
}

test('an identity-only request reaches official feedback after live session and publication checks', async () => fixture(async f => {
  for (let attempt = 0; attempt < 2; attempt++) {
    f.calls.length = 0
    assert.deepEqual(await f.submit(command()), { status: 'ready', feedback })
    assert.deepEqual(f.calls, ['client', 'session', 'continuity', 'profile', 'publication', 'session'])
  }
  // Each accepted request counts once; retries are counted again by design.
  assert.deepEqual(f.events, [[slug, true], [slug, true]])
  assert.doesNotMatch(JSON.stringify(f.events), /live-student|live-session|answer/)
  f.state.published.materials = [{ question, feedback: { ...feedback, rubric: null } }]
  assert.equal((await f.submit()).feedback.rubric, null)
  assert.deepEqual(f.events.at(-1), [slug, false])
}))

test('disabled, signed-out, switched or incomplete accounts never read publication or emit events', async () => fixture(async f => {
  f.state.enabled = false
  assert.deepEqual(await f.submit(), { status: 'unavailable' })
  assert.deepEqual(f.calls, [])
  f.state.enabled = true; f.state.first = null
  assert.deepEqual(await f.submit(), { status: 'signed-out' })
  f.state.first = f.context; f.state.token = false
  assert.deepEqual(await f.submit(), { status: 'session-changed' })
  f.state.token = true
  assert.deepEqual(await f.submit(command(), null), { status: 'session-changed' })
  for (const profile of ['incomplete', 'signed-out', 'missing-profile', 'invariant-failure', 'unavailable']) {
    f.state.profile = profile
    assert.deepEqual(await f.submit(), { status: profile === 'incomplete' ? 'incomplete' : profile === 'signed-out' ? 'signed-out' : 'unavailable' })
  }
  assert.equal(f.calls.includes('publication'), false)
  assert.deepEqual(f.events, [])
}))

test('unpublished answers, foreign questions and stale theory revisions cannot reveal feedback', async () => fixture(async f => {
  assert.deepEqual(await f.submit({ ...command(), publishedRevision: 1 }), { status: 'content-changed' })
  assert.deepEqual(await f.submit({ ...command(), itemId: feedback.modelAnswer.itemId }), { status: 'content-changed' })
  f.state.published.materials = [{ question, feedback: null }]
  assert.deepEqual(await f.submit(), { status: 'content-changed' })
  f.state.published.materials = []
  assert.deepEqual(await f.submit(), { status: 'content-changed' })
  for (const status of ['signed-out', 'not-found', 'unavailable', 'invariant-failure']) {
    f.state.published = { status }
    assert.deepEqual(await f.submit(), { status: status === 'invariant-failure' ? 'unavailable' : status })
  }
  assert.deepEqual(f.events, [])
}))

test('revocation and account/session switches during content reads refuse the reveal', async () => fixture(async f => {
  f.state.second = null
  assert.deepEqual(await f.submit(), { status: 'signed-out' })
  f.state.second = { ...f.context, user: { id: 'other-student' } }
  assert.deepEqual(await f.submit(), { status: 'session-changed' })
  f.state.second = { ...f.context, sessionId: 'other-session' }
  assert.deepEqual(await f.submit(), { status: 'session-changed' })
  assert.deepEqual(f.events, [])
}))

test('invalid requests and private upstream failures return no official material or error details', async () => fixture(async f => {
  for (const answer of ['', ' ', 'x', longDraft(), 1]) {
    assert.deepEqual(await f.submit({ ...command(), answer }), { status: 'invalid-request' })
  }
  assert.equal(f.calls.includes('publication'), false)
  f.state.error = true
  assert.deepEqual(await f.submit(), { status: 'unavailable' })
  assert.deepEqual(f.events, [])
}))

test('submission analytics excludes answer text, identity and ambient request headers and tolerates failure', async () => {
  const original = Module._load, file = require.resolve('./events.ts'), calls = []
  try {
    Module._load = function(name, ...args) {
      if (name === '@vercel/analytics/server') return { track: async (...event) => { calls.push(event); throw new Error('offline') } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    await assert.doesNotReject(require(file).recordTheorySubmission(slug, true))
    assert.deepEqual(calls, [['theory_answer_submitted', { course_slug: slug, has_rubric: true },
      { headers: { 'user-agent': 'CampusIntel product events' } }]])
  } finally { Module._load = original; delete require.cache[file] }
})
