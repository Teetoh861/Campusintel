const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { getCourseAccessForVerifiedStudent: read } = require('./access.ts')
const decision = (id, extra = {}) => ({ institutional_course_id: id, allowed: true, reason: 'own-list',
  on_list: true, team_added: false, ends_at: '2027-03-08T23:00:00Z', ...extra })

test('course projection sends bounded IDs and never a caller-supplied student or tier', async () => {
  const id = randomUUID(), calls = []
  const client = { rpc: async (...args) => { calls.push(args); return { data: [decision(id)], error: null } } }
  const result = await read(client, [id, id])
  assert.equal(result.status, 'ok')
  assert.equal(result.decisions.get(id).reason, 'own-list')
  assert.deepEqual(calls, [['get_my_course_access', { p_institutional_course_ids: [id] }]])
  assert.equal((await read(client, [])).decisions.size, 0)
  assert.equal((await read(client, ['invalid'])).status, 'unavailable')
  assert.equal((await read(client, Array.from({ length: 201 }, () => randomUUID()))).status, 'unavailable')
  assert.equal(calls.length, 1)
})

test('missing, duplicate, foreign, malformed or inconsistent decisions fail closed', async () => {
  const a = randomUUID(), b = randomUUID()
  for (const data of [null, [], [decision(b)], [decision(a), decision(a)], [decision(a, { reason: 'outside-list' })],
    [decision(a, { reason: 'outside-list', allowed: false, internal: 'hidden' })], [{ ...decision(a), allowed: 'true' }]]) {
    assert.deepEqual(await read({ rpc: async () => ({ data, error: null }) }, [a]), { status: 'unavailable' })
  }
  assert.deepEqual(await read({ rpc: async () => ({ data: null, error: { code: '42501' } }) }, [a]), { status: 'signed-out' })
  assert.deepEqual(await read({ rpc: async () => { throw new Error('private') } }, [a]), { status: 'unavailable' })
})

test('each permitted and refused state comes from the database, independently of a global plan', async () => {
  const id = randomUUID()
  for (const reason of ['free', 'operator', 'own-list', 'team-added', 'needs-plan', 'outside-list',
    'needs-selection', 'missing-calendar', 'unavailable']) {
    const allowed = ['free', 'operator', 'own-list', 'team-added'].includes(reason)
    const result = await read({ rpc: async () => ({ data: [decision(id, { reason, allowed })], error: null }) }, [id])
    assert.equal(result.status, 'ok')
    assert.equal(result.decisions.get(id).allowed, allowed)
  }
})
