const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Module = require('node:module')
const { scheduleDeletionSchema, cancelDeletionSchema } = require('../auth/schemas.ts')

test('deletion requests reject spoofed identities, missing consent, overlong passwords and malformed request IDs', () => {
  const password = randomUUID(), input = { password, confirmed: true }, tooLong = 'x'.repeat(129)
  assert.equal(scheduleDeletionSchema.safeParse(input).success, true)
  for (const patch of [{ userId: randomUUID() }, { deadline: '2099-01-01' }, { confirmed: false },
    { confirmed: undefined }, { password: '' }, { password: tooLong }]) {
    assert.equal(scheduleDeletionSchema.safeParse({ ...input, ...patch }).success, false)
  }
  assert.equal(cancelDeletionSchema.safeParse({ requestId: randomUUID() }).success, true)
  assert.equal(cancelDeletionSchema.safeParse({ requestId: 'invalid' }).success, false)
  assert.equal(cancelDeletionSchema.safeParse({ requestId: randomUUID(), userId: randomUUID() }).success, false)
})

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const user = { id: randomUUID(), email: randomUUID() + '@example.test' }, sessionId = randomUUID()
  const state = { lifecycle: { status: 'active', deletionAllowed: true }, rpcError: false, reads: 0, signedOut: false }
  const client = { auth: {
    getUser: async () => ({ data: { user: state.signedOut ? null : user }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: user.id, session_id: sessionId } }, error: null }),
  }, rpc: async name => {
    state.reads++; assert.equal(name, 'read_account_lifecycle')
    return { data: state.lifecycle, error: state.rpcError ? {} : null }
  } }
  try {
    Module._load = function (name, ...args) {
      if (name === '@/lib/supabase/server') return { createClient: async () => client }
      return load.call(this, name, ...args)
    }
    delete require.cache[require.resolve('../auth/student-state.ts')]
    await run({ state, client, user, sessionId, student: require('../auth/student-state.ts') })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('all ordinary server helpers deny scheduled and expired accounts; restricted identity is explicit', async () => fixture(async f => {
  assert.equal((await f.student.getStudentSessionUser()).id, f.user.id)
  for (const status of ['scheduled', 'expired']) {
    f.state.lifecycle = { status, requestId: randomUUID(), deadline: '2026-10-16T00:00:00+00:00' }
    assert.equal(await f.student.getStudentSessionUser(), null)
    assert.equal(await f.student.getStudentSessionContext(), null)
    assert.equal(await f.student.hasStudentSession(), false)
    assert.equal((await f.student.getStudentSessionContext(undefined, undefined, { allowRestricted: true })).user.id, f.user.id)
    const rejected = await f.student.rejectExistingStudent()
    assert.equal(rejected.status, 409)
    assert.equal((await rejected.json()).next, '/account/deletion')
    assert.equal(f.state.lifecycle.status, status, 'no read restores the account')
  }
}))

test('revoked JWTs and malformed/unavailable lifecycle responses fail closed even when Auth returns a user', async () => fixture(async f => {
  f.state.lifecycle = { status: 'signed-out' }
  assert.equal(await f.student.getStudentSessionUser(), null)
  assert.equal(await f.student.getStudentSessionContext(undefined, undefined, { allowRestricted: true }), null)
  for (const data of [null, {}, { status: 'active' }, { status: 'active', deletionAllowed: true, token: 'unexpected' }]) {
    f.state.lifecycle = data
    await assert.rejects(() => f.student.getStudentSessionUser())
  }
  f.state.rpcError = true
  await assert.rejects(() => f.student.getStudentSessionUser())
  f.state.signedOut = true; f.state.reads = 0
  assert.equal(await f.student.getStudentSessionUser(), null)
  assert.equal(f.state.reads, 0, 'a missing user never queries private lifecycle data')
}))
