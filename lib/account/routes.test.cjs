const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Module = require('node:module')

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const calls = [], requestId = randomUUID(), password = randomUUID()
  const state = { mutation: 'ready', schedule: 'scheduled', cancel: 'active', fail: false }
  try {
    Object.assign(process.env, { STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/mutation-context') return { getAuthenticatedMutationContext: async (response, token, options) => {
        calls.push('authorize'); assert.equal(token, 'rendered-session'); assert.equal(options.allowRestricted, true)
        response.cookies.set('fixture-refresh', 'rotated', { httpOnly: true })
        if (state.mutation !== 'ready') return { status: state.mutation }
        return { status: 'ready', context: { sessionId: randomUUID(), user: { id: randomUUID(), email: randomUUID() + '@example.test' },
          client: { rpc: async (operation, input) => {
            calls.push('cancel'); assert.equal(operation, 'cancel_student_deletion'); assert.deepEqual(input, { p_request_id: requestId })
            return { data: { status: state.cancel }, error: state.fail ? {} : null }
          } },
        } }
      } }
      if (name === '@/lib/account/deletion-server') return { scheduleStudentDeletion: async (_, supplied) => {
        calls.push('schedule'); assert.equal(supplied, password)
        if (state.fail) throw new Error('private service details')
        return { status: state.schedule }
      } }
      if (name === '@/lib/auth/rate-limit') return { consumeAuthLimit: async action => {
        calls.push('limit'); assert.equal(action, 'ACCOUNT_DELETION')
      } }
      if (name === '@/lib/auth/session-generation') return { advanceStudentSessionGeneration: async () => { calls.push('tombstone') } }
      if (name === '@/lib/auth/recovery-grant') return { clearRecoveryCookie: () => { calls.push('clear-recovery') } }
      return load.call(this, name, ...args)
    }
    for (const action of ['schedule-deletion', 'cancel-deletion']) delete require.cache[require.resolve('../../app/api/auth/' + action + '/route.ts')]
    const post = (action, options = {}) => require('../../app/api/auth/' + action + '/route.ts').POST(new Request('http://localhost:3000/api/auth/' + action, {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-campus-account-continuity': 'rendered-session', ...options.headers },
      body: JSON.stringify(options.body ?? (action === 'schedule-deletion' ? { password, confirmed: true } : { requestId })),
    }))
    await run({ calls, state, requestId, password, post })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

test('both deletion endpoints reject disabled rollout, CSRF and spoofed identities before authorization or provider work', async () => fixture(async f => {
  for (const action of ['schedule-deletion', 'cancel-deletion']) {
    for (const headers of [{ origin: 'https://foreign.test' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await f.post(action, { headers })).status, 403)
    }
    assert.equal((await f.post(action, { body: { userId: randomUUID() } })).status, 400)
    process.env.STUDENT_AUTH_ENABLED = 'false'
    assert.equal((await f.post(action)).status, 503)
    process.env.STUDENT_AUTH_ENABLED = 'true'
  }
  assert.deepEqual(f.calls, [])
}))

test('schedule checks continuity and rate policy before password verification, and changes browser authority only on success', async () => fixture(async f => {
  const statuses = [['signed-out', 401], ['session-changed', 409], ['unavailable', 503]]
  for (const [status, code] of statuses) {
    f.state.mutation = status; f.calls.length = 0
    const response = await f.post('schedule-deletion')
    assert.equal(response.status, code); assert.deepEqual(f.calls, ['authorize'])
  }
  f.state.mutation = 'ready'
  for (const [status, code] of [['password-invalid', 400], ['operator-excluded', 403], ['expired', 403], ['scheduled', 200]]) {
    f.state.schedule = status; f.calls.length = 0
    const response = await f.post('schedule-deletion')
    assert.equal(response.status, code)
    assert.deepEqual(f.calls, code === 200 ? ['authorize','limit','schedule','clear-recovery','tombstone'] : ['authorize','limit','schedule'])
    assert.match(response.headers.get('set-cookie'), /fixture-refresh=rotated/)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    if (code === 200) assert.deepEqual(await response.json(), { next: '/login?state=deletion-scheduled' })
  }
  f.state.fail = true; f.calls.length = 0
  const failure = await f.post('schedule-deletion')
  assert.equal(failure.status, 503)
  assert.doesNotMatch(JSON.stringify(await failure.json()), /private|service/)
  assert.equal(f.calls.includes('tombstone'), false)
}))

test('only an authorized matching cancellation restores; expired/conflicting/failed responses remain failures', async () => fixture(async f => {
  for (const [status, code] of [['signed-out', 401], ['session-changed', 409], ['unavailable', 503]]) {
    f.state.mutation = status; f.calls.length = 0
    assert.equal((await f.post('cancel-deletion')).status, code)
    assert.deepEqual(f.calls, ['authorize'])
  }
  f.state.mutation = 'ready'
  for (const [status, code] of [['expired', 403], ['conflict', 409], ['active', 200]]) {
    f.state.cancel = status
    const response = await f.post('cancel-deletion')
    assert.equal(response.status, code)
    if (code === 200) assert.deepEqual(await response.json(), { next: '/dashboard' })
  }
  f.state.fail = true
  const failure = await f.post('cancel-deletion')
  assert.equal(failure.status, 503)
  assert.deepEqual(await failure.json(), { error: 'Something went wrong. Please try again.' })
}))
