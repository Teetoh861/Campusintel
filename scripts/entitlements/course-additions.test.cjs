const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { run } = require('./ops.cjs')
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:61721', SUPABASE_SECRET_KEY: 'local-fixture' }
const user = randomUUID(), course = randomUUID(), term = randomUUID(), request = randomUUID()
const note = ['--actor', 'Ops', '--reason', 'separate course requested']
function harness() {
  const calls = []
  return { calls, run: args => run(args, ENV, async (url, init) => {
    calls.push({ name: new URL(url).pathname.split('/').at(-1), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ state: 'added' }))
  }, () => {}) }
}
const add = ['course-add', '--user', user, '--course', course, '--term', term,
  '--expected-profile-revision', '3', '--request', request]
test('add, status and revoke map only to the narrow service functions', async () => {
  const h = harness()
  await h.run([...add, ...note])
  await h.run(['course-status', '--user', user])
  await h.run(['course-revoke', '--user', user, '--addition', request, '--expected-revision', '1', ...note])
  assert.deepEqual(h.calls, [
    { name: 'admin_add_student_course', body: { p_user_id: user, p_institutional_course_id: course, p_term_id: term,
      p_expected_profile_revision: 3, p_idempotency_key: request, p_actor: 'Ops', p_reason: 'separate course requested' } },
    { name: 'admin_student_course_status', body: { p_user_id: user } },
    { name: 'admin_revoke_student_course', body: { p_user_id: user, p_addition_id: request, p_expected_revision: 1,
      p_actor: 'Ops', p_reason: 'separate course requested' } },
  ])
})
test('bad identity, revision and missing audit note never send a mutation', async () => {
  const h = harness()
  await assert.rejects(h.run(add), /actor/)
  await assert.rejects(h.run([...add, '--actor', 'Ops']), /reason/)
  await assert.rejects(h.run([...add.slice(0, -2), ...note]), /request/)
  await assert.rejects(h.run([...add.map(value => value === course ? 'ACC101' : value), ...note]), /course/)
  await assert.rejects(h.run([...add.map(value => value === '3' ? '-1' : value), ...note]), /revision/)
  await assert.rejects(h.run(['course-revoke', '--user', user, '--addition', request,
    '--expected-revision', '0', ...note]), /revision/)
  assert.equal(h.calls.length, 0)
})
