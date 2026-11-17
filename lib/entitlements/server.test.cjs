// lib/entitlements/server.test.cjs — The eligibility reads behind every Discovery Pass offer and every free month
// offer: each asked only when the database could still give this student one, bound to the verified session and its
// confirmed address, and closed on every failure (missing keys, an unverifiable session, an error, a malformed
// answer). Run with lib/auth/test-loader.cjs.
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

// A plan read in the claim window: launched two days ago, the claim closes in eight, no month and no paid plan. While
// the claim is open the database offers no pass.
const MONTH_ENDS = '2026-12-22T12:00:00+00:00'
const claimable = { ...wire('not-offered'), now: '2026-11-22T12:00:00.000+00:00', actual_launch_at: '2026-11-20T08:00:00+00:00',
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: '2026-11-30T08:00:00+00:00' } }

function fixture({ keys = KEYS, summary = wire(), user = { id: USER, email: ' Student@Example.test ' }, userError = null,
  claims = { sub: USER, session_id: SESSION }, claimsError = null, answer = { data: { eligible: true }, error: null },
  month = { data: { eligible: true, ends_at: MONTH_ENDS }, error: null },
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
    const reply = name === 'early_access_claim_eligibility' ? month : answer
    if (reply instanceof Error) throw reply
    return reply
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

test('an entitlement read can opt out of Discovery eligibility without losing the plan', async () => {
  const f = fixture()
  const read = await f.read({ discoveryEligibility: false })
  assert.equal(read.status, 'ok')
  assert.equal(read.entitlement.discovery_eligible, false)
  assert.deepEqual(f.serviceCalls(), [])
  assert.deepEqual(f.calls, [['student', 'get_my_entitlement']], 'the plan itself is still read')
})

test('the course read model uses per-course access without asking for Discovery eligibility', () => {
  const source = require('node:fs').readFileSync(require.resolve('../courses/read-model.ts'), 'utf8')
  assert.match(source, /\bgetCourseAccessForVerifiedStudent\s*\(\s*client\s*,/,
    'the course reader asks for per-course access on the verified client')
  assert.doesNotMatch(source, /\breadEntitlementForVerifiedStudent\b/,
    'the course reader does not use the account entitlement/eligibility path')
  assert.doesNotMatch(source, /\b(?:discoveryEligibility|discovery_pass_eligibility)\b/,
    'the course reader never asks for Discovery eligibility')
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

// ---- The free month (Early Access) -----------------------------------------------------------------------------

test('a student who could claim is asked about with the verified session and the keyed hashes, and offered the month with the database end date', async () => {
  const f = fixture({ summary: claimable })
  const read = await f.read({ freeMonth: true })
  assert.equal(read.status, 'ok')
  assert.deepEqual(read.entitlement.free_month, { endsAt: MONTH_ENDS }, 'the end date is the database answer, unchanged')
  assert.equal(read.entitlement.discovery_eligible, false, 'no pass is offered while the claim is open')
  assert.deepEqual(f.serviceCalls(), [['service', 'early_access_claim_eligibility', { p_session_id: SESSION,
    p_claim_hashes: claimHashes(readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: KEYS }), 'student@example.test') }]],
  'one read, carrying the session and the hashes and no date or time')
})

test('a student the database says cannot claim is offered nothing, and no reason is kept', async () => {
  const read = await fixture({ summary: claimable, month: { data: { eligible: false, reason: 'paid' }, error: null } })
    .read({ freeMonth: true })
  assert.equal(read.status, 'ok')
  assert.equal(read.entitlement.free_month, null)
  assert.doesNotMatch(JSON.stringify(read.entitlement), /reason|paid-plan/)
})

test('a surface that does not offer the month never asks about it', async () => {
  const f = fixture({ summary: claimable })
  for (const options of [undefined, {}, { discoveryEligibility: false }, { freeMonth: false }]) {
    const read = await f.read(options)
    assert.equal(read.entitlement.free_month, null, JSON.stringify(options))
  }
  assert.deepEqual(f.serviceCalls(), [])
})

test('the month is asked about only while the instants the database reported say the claim could be open for this account', async () => {
  const paid = { plan: 'standard_semester', tier: 'standard', period: 'semester', order_id: '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab',
    amount_kobo: 400000, paid_at: '2026-11-21T10:00:00+00:00', first_ends_at: '2027-03-08T23:00:00+00:00',
    second_starts_at: null, second_ends_at: null, term_session_label: '2026/2027' }
  const cases = {
    'no launch recorded': { ...claimable, actual_launch_at: null, early_access: { ...claimable.early_access, enrollment_closes_at: null } },
    'the claim has closed': { ...claimable, now: '2026-11-30T08:00:00.000+00:00' },
    'a month is running': { ...claimable, tier: 'full', access: { source: 'early_access', ends_at: MONTH_ENDS },
      early_access: { ...claimable.early_access, status: 'active', starts_at: claimable.now, ends_at: MONTH_ENDS } },
    'a month was had': { ...claimable, early_access: { ...claimable.early_access, status: 'ended', starts_at: claimable.now, ends_at: claimable.now } },
    'a paid plan': { ...claimable, tier: 'full', access: { source: 'paid', ends_at: paid.first_ends_at }, plans_on_sale: true, paid },
    'a database from before the claim': { ...claimable, early_access: { ...claimable.early_access, status: 'awaiting-launch' } },
  }
  for (const [label, summary] of Object.entries(cases)) {
    const f = fixture({ summary })
    const read = await f.read({ freeMonth: true })
    assert.equal(read.status, 'ok', label)
    assert.equal(read.entitlement.free_month, null, label)
    assert.deepEqual(f.serviceCalls(), [], label)
  }
})

test('every failure of the free month read fails closed, and the plan itself still loads', async () => {
  const cases = {
    'keys missing': { keys: null },
    'keys malformed': { keys: '1:short' },
    'database error': { month: { data: null, error: { code: '42501', message: 'denied' } } },
    'a database without the function': { month: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    'malformed answer': { month: { data: { eligible: 'true', ends_at: MONTH_ENDS }, error: null } },
    'eligible with no end date': { month: { data: { eligible: true }, error: null } },
    'empty answer': { month: { data: null, error: null } },
    'request throws': { month: new Error('network') },
    'service configuration missing': { config: () => { throw new Error('Missing Supabase configuration') } },
    'session user unreadable': { userError: { name: 'AuthApiError', message: 'failed' } },
    'no confirmed address': { user: { id: USER, email: undefined } },
    'claims unreadable': { claimsError: { message: 'failed' } },
    'claims for another user': { claims: { sub: '33333333-3333-4333-8333-333333333333', session_id: SESSION } },
    'no session id': { claims: { sub: USER } },
  }
  for (const [label, options] of Object.entries(cases)) {
    const read = await fixture({ summary: claimable, ...options }).read({ freeMonth: true })
    assert.equal(read.status, 'ok', label)
    assert.equal(read.entitlement.free_month, null, label)
  }
})

test('at most one free month read per request, and a failed one is not retried', async () => {
  const f = fixture({ summary: claimable })
  const reads = await f.load(server => Promise.all([1, 2, 3].map(() =>
    server.readEntitlementForVerifiedStudent(f.client, { freeMonth: true }))))
  assert.deepEqual(reads.map(read => read.entitlement.free_month), [{ endsAt: MONTH_ENDS }, { endsAt: MONTH_ENDS }, { endsAt: MONTH_ENDS }])
  assert.equal(f.serviceCalls().length, 1)
  const failing = fixture({ summary: claimable, month: new Error('network') })
  const closed = await failing.load(server => Promise.all([1, 2].map(() =>
    server.readEntitlementForVerifiedStudent(failing.client, { freeMonth: true }))))
  assert.deepEqual(closed.map(read => read.entitlement.free_month), [null, null])
  assert.equal(failing.serviceCalls().length, 1)
})
