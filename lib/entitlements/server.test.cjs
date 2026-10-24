// lib/entitlements/server.test.cjs — The eligibility read behind every Discovery Pass offer: asked only when the database
// could still give this student a pass, bound to the verified session and its confirmed address, and false on every
// failure (missing keys, an unverifiable session, an error, a malformed answer). Run with lib/auth/test-loader.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { claimHashes, readClaimHashKeys } = require('./claim-hash.ts')

const KEYS = '2:second-secret-of-at-least-thirty-two-chars,1:first-secret-of-at-least-thirty-two-chars'
const USER = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'
const wire = (trial = 'available', discovery = true) => ({ now: '2026-10-30T12:00:00.000+00:00',
  planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null, trial_hours: 72, expiry_notice_hours: 12,
  tier: 'free', access: null, trial: { status: trial, policy: null, starts_at: null, ends_at: null, available_from: null },
  ...(discovery ? { discovery: { cbt_questions: 50, ai_sets: 1, previews: [] } } : { trial_days: 7 }),
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } })

function fixture({ keys = KEYS, summary = wire(), user = { id: USER, email: ' Student@Example.test ' }, userError = null,
  claims = { sub: USER, session_id: SESSION }, claimsError = null, answer = { data: { eligible: true }, error: null },
  config = () => ({ url: 'http://127.0.0.1:1' }) } = {}) {
  const calls = []
  const client = {
    async rpc(name) { calls.push(['student', name]); return { data: summary, error: null } },
    auth: {
      async getUser() { return { data: { user }, error: userError } },
      async getClaims() { return { data: claims === null ? null : { claims }, error: claimsError } },
    },
  }
  const service = { async rpc(name, args) {
    calls.push(['service', name, args])
    if (answer instanceof Error) throw answer
    return answer
  } }
  const mocks = {
    '@supabase/supabase-js': { createClient: () => service },
    '@vercel/analytics/server': { track: async () => {} },
    '@/lib/auth/config': { getSupabaseConfig: config, getAuthSecretKey: () => 'service-key', isStudentAuthEnabled: () => true },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/auth/student-state': { getStudentSessionContext: async () => null },
    '@/lib/auth/rate-limit': { getBucket: () => 'a'.repeat(64) },
  }
  // `use` runs against one load of server.ts, so its per-request memo is shared by every call inside it.
  async function load(use) {
    const original = Module._load
    const before = process.env.ENTITLEMENT_CLAIM_HASH_KEYS
    Module._load = function (name, ...args) {
      return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args)
    }
    if (keys === null) delete process.env.ENTITLEMENT_CLAIM_HASH_KEYS
    else process.env.ENTITLEMENT_CLAIM_HASH_KEYS = keys
    try {
      delete require.cache[require.resolve('./server.ts')]
      return await use(require('./server.ts'))
    } finally {
      Module._load = original
      if (before === undefined) delete process.env.ENTITLEMENT_CLAIM_HASH_KEYS
      else process.env.ENTITLEMENT_CLAIM_HASH_KEYS = before
    }
  }
  const read = options => load(server => server.readEntitlementForVerifiedStudent(client, options))
  return { calls, client, load, read, serviceCalls: () => calls.filter(call => call[0] === 'service') }
}

test('an eligible student is asked about with the verified session and the keyed hashes of the confirmed address', async () => {
  const f = fixture()
  const read = await f.read()
  assert.equal(read.status, 'ok')
  assert.equal(read.entitlement.discovery_eligible, true)
  assert.deepEqual(f.serviceCalls(), [['service', 'discovery_pass_eligibility', { p_session_id: SESSION,
    p_claim_hashes: claimHashes(readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: KEYS }), 'student@example.test') }]])
})

test('a student the database says is not eligible is not offered a pass', async () => {
  const read = await fixture({ answer: { data: { eligible: false }, error: null } }).read()
  assert.equal(read.status, 'ok')
  assert.equal(read.entitlement.discovery_eligible, false)
})

test('every failure of the eligibility read fails closed, and the plan itself still loads', async () => {
  const cases = {
    'keys missing': { keys: null },
    'keys malformed': { keys: '1:short' },
    'database error': { answer: { data: null, error: { code: '42501', message: 'denied' } } },
    'malformed answer': { answer: { data: { eligible: 'true' }, error: null } },
    'empty answer': { answer: { data: null, error: null } },
    'request throws': { answer: new Error('network') },
    'service configuration missing': { config: () => { throw new Error('Missing Supabase configuration') } },
    'session user unreadable': { userError: { name: 'AuthApiError', message: 'failed' } },
    'no confirmed address': { user: { id: USER, email: undefined } },
    'claims unreadable': { claimsError: { message: 'failed' } },
    'claims for another user': { claims: { sub: '33333333-3333-4333-8333-333333333333', session_id: SESSION } },
    'no session id': { claims: { sub: USER } },
  }
  for (const [label, options] of Object.entries(cases)) {
    const read = await fixture(options).read()
    assert.equal(read.status, 'ok', label)
    assert.equal(read.entitlement.discovery_eligible, false, label)
  }
})

test('missing keys never reach the database', async () => {
  const f = fixture({ keys: null })
  await f.read()
  assert.deepEqual(f.serviceCalls(), [])
})

test('only a student the database could still give a pass is asked about', async () => {
  for (const [label, summary] of [['active pass', wire('active')], ['ended pass', wire('ended')],
    ['Early Access history', wire('not-offered')], ['database from before the pass', wire('available', false)]]) {
    const f = fixture({ summary: label === 'active pass' || label === 'ended pass'
      ? { ...summary, trial: { ...summary.trial, policy: 'discovery', starts_at: summary.now, ends_at: summary.now } } : summary })
    const read = await f.read()
    assert.equal(read.entitlement.discovery_eligible, false, label)
    assert.deepEqual(f.serviceCalls(), [], label)
  }
})

test('a course list reads course access only: no eligibility call, and no pass is offered', async () => {
  const f = fixture()
  const read = await f.read({ discoveryEligibility: false })
  assert.equal(read.status, 'ok')
  assert.equal(read.entitlement.discovery_eligible, false)
  assert.deepEqual(f.serviceCalls(), [])
  assert.deepEqual(f.calls, [['student', 'get_my_entitlement']], 'the plan itself is still read')
})

test('every entitlement read in the course read model opts out of the eligibility call', () => {
  const source = require('node:fs').readFileSync(require.resolve('../courses/read-model.ts'), 'utf8')
  const calls = source.match(/readEntitlementForVerifiedStudent\([^)]*\)/g) ?? []
  assert.ok(calls.length > 0, 'the read model reads the plan')
  for (const call of calls) assert.match(call, /\{ discoveryEligibility: false \}/, call)
})

test('at most one eligibility read per request, however many surfaces of the page ask', async () => {
  const f = fixture()
  const reads = await f.load(server => Promise.all([server.readEntitlementForVerifiedStudent(f.client),
    server.readEntitlementForVerifiedStudent(f.client), server.readEntitlementForVerifiedStudent(f.client)]))
  assert.deepEqual(reads.map(read => read.entitlement.discovery_eligible), [true, true, true])
  assert.equal(f.serviceCalls().length, 1)
  // Another request has its own client, and asks again (the service mock here is f's, so f records both).
  const g = fixture()
  const before = f.serviceCalls().length
  await f.load(async server => {
    await server.readEntitlementForVerifiedStudent(f.client)
    await server.readEntitlementForVerifiedStudent(g.client)
    await server.readEntitlementForVerifiedStudent(g.client)
  })
  assert.equal(f.serviceCalls().length - before, 2, 'one read for each request client')
})

test('a failed eligibility read is not retried within the request, and stays closed', async () => {
  const f = fixture({ answer: new Error('network') })
  const reads = await f.load(server => Promise.all([server.readEntitlementForVerifiedStudent(f.client),
    server.readEntitlementForVerifiedStudent(f.client)]))
  assert.deepEqual(reads.map(read => read.entitlement.discovery_eligible), [false, false])
  assert.equal(f.serviceCalls().length, 1)
})
