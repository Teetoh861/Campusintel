// lib/entitlements/contract.test.cjs — The client-boundary contract: strict commands, well-formed results only, and a
// summary that never carries a code, phone number or hint.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { entitlementCommandSchema, entitlementResultSchema, entitlementSummarySchema, freeMonthCouldBeClaimed } =
  require('./contract.ts')

test('commands are strict: no phone, email, user id or extra field can reach the server', () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'activate-discovery-pass' }).success, true)
  for (const command of [
    { action: 'activate-discovery-pass', phone: '08031234567' },
    { action: 'activate-discovery-pass', email: 'someone@example.test' },
    { action: 'send-trial-code', phone: '08031234567' },
    { action: 'verify-trial-code', challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' },
    { action: 'claim-early-access' },
    { action: 'grant-access' },
  ]) assert.equal(entitlementCommandSchema.safeParse(command).success, false, JSON.stringify(command))
})

test('the client accepts only well-formed results', () => {
  assert.equal(entitlementResultSchema.safeParse({ status: 'pass-activated', endsAt: '2026-10-29T09:00:00.000Z' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'already-claimed' }).success, true, 'no retention is stated')
  assert.equal(entitlementResultSchema.safeParse({ status: 'already-claimed', retentionMonths: 24 }).success, true,
    'a server from before 20261023120000 may still send it')
  assert.equal(entitlementResultSchema.safeParse({ status: 'already-claimed', retentionMonths: 0 }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'rate-limited' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'pass-activated' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'granted-everything' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'code-sent', challengeId: 'x', phoneHint: '567',
    expiresAt: 'a', resendAt: 'b' }).success, false, 'the retired phone-code results are not accepted')
  assert.equal(entitlementResultSchema.safeParse({ status: 'phone-already-used' }).success, false)
})

test('the summary drops the compatibility otp key and never exposes a code or phone hint', () => {
  const wire = { now: '2026-10-30T12:00:00.000+00:00', planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null,
    trial_hours: 72, trial_days: 3, expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } }
  for (const otp of [null, undefined, { challenge_id: '11111111-1111-4111-8111-111111111111', phone_hint: '567' }]) {
    const parsed = entitlementSummarySchema.parse(otp === undefined ? wire : { ...wire, otp })
    assert.equal('otp' in parsed, false)
    assert.doesNotMatch(JSON.stringify(parsed), /567|challenge/)
  }
})

test('eligibility never comes from the wire: a parsed summary offers no pass until the server has read it', () => {
  const wire = { now: '2026-10-30T12:00:00.000+00:00', planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null,
    trial_hours: 72, expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } }
  assert.equal(entitlementSummarySchema.parse(wire).discovery_eligible, false)
  assert.equal(entitlementSummarySchema.parse({ ...wire, discovery_eligible: true }).discovery_eligible, false)
})

test('the free month command names the action and the courses on the page, and nothing else', () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'claim-free-month', profileRevision: 4 }).success, true)
  for (const command of [
    // The courses the student saw are always named: a month never starts unbound.
    { action: 'claim-free-month' },
    { action: 'claim-free-month', profileRevision: -1 },
    { action: 'claim-free-month', profileRevision: '4' },
    // No date, time or length is accepted: the database starts and ends the month on its own clock.
    { action: 'claim-free-month', profileRevision: 4, endsAt: '2027-06-30T00:00:00.000Z' },
    { action: 'claim-free-month', profileRevision: 4, startsAt: '2026-11-01T00:00:00.000Z' },
    { action: 'claim-free-month', profileRevision: 4, now: '2026-11-25T00:00:00.000Z' },
    { action: 'claim-free-month', profileRevision: 4, days: 365 },
    { action: 'claim-free-month', profileRevision: 4, email: 'someone@example.test' },
    { action: 'claim-free-month', profileRevision: 4, userId: '22222222-2222-4222-8222-222222222222' },
  ]) assert.equal(entitlementCommandSchema.safeParse(command).success, false, JSON.stringify(command))
})

test('the client accepts only well-formed free month results', () => {
  assert.equal(entitlementResultSchema.safeParse({ status: 'month-started', endsAt: '2026-12-30T23:00:00.000Z' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'month-started' }).success, false, 'a started month names its end')
  assert.equal(entitlementResultSchema.safeParse({ status: 'offer-ended' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'offer-unavailable' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'offer-unavailable', reason: 'paid' }).success, false,
    'no reason ever reaches the browser')
})

test('the free access offer never comes from the wire, and the claim is asked about only while the database says it could be open', () => {
  // The close the launch stored: the end of 30 December in Lagos, where every claim ends too (20261126100000).
  const closes = '2026-12-30T23:00:00Z'
  const wire = { now: '2026-11-22T12:00:00.000+00:00', planned_launch_at: '2026-10-24T23:00:00+00:00',
    actual_launch_at: '2026-11-20T08:00:00+00:00', trial_hours: 72, expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: closes } }
  assert.equal(entitlementSummarySchema.parse(wire).free_month, null)
  assert.equal(entitlementSummarySchema.parse({ ...wire, free_month: { endsAt: closes, closesAt: closes } }).free_month, null,
    'an offer on the wire is ignored: only the eligibility read on the server sets it')
  const could = change => freeMonthCouldBeClaimed(entitlementSummarySchema.parse({ ...wire, ...change }))
  assert.equal(could({}), true, 'launched, not yet closed, never claimed, no paid plan')
  assert.equal(could({ now: '2026-12-10T08:00:00+00:00' }), true, '20 days after the launch: there is no 10-day window')
  assert.equal(could({ now: '2026-12-30T22:59:59.999Z' }), true, 'the last moment of 30 December in Lagos')
  assert.equal(could({ now: closes }), false, 'at the closing instant, the end of 30 December')
  assert.equal(could({ actual_launch_at: null, early_access: { ...wire.early_access, enrollment_closes_at: null } }), false,
    'before the launch')
  assert.equal(could({ now: '2026-11-20T07:59:59+00:00' }), false, 'a moment before the launch')
  assert.equal(could({ early_access: { ...wire.early_access, status: 'active' } }), false, 'a month already running')
  assert.equal(could({ early_access: { ...wire.early_access, status: 'ended' } }), false, 'a month already had')
  assert.equal(could({ plans_on_sale: true, paid: { plan: 'standard_semester', tier: 'standard', period: 'semester',
    order_id: '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab', amount_kobo: 400000, paid_at: '2026-11-21T10:00:00+00:00',
    first_ends_at: '2027-03-08T23:00:00+00:00', second_starts_at: null, second_ends_at: null, term_session_label: '2026/2027' } }),
  false, 'a paid plan')
  // A database from before the claim still answers the list's statuses: nothing is asked about, nothing is offered.
  for (const status of ['awaiting-launch', 'pending', 'enrollment-closed', 'unavailable', 'account-restricted']) {
    assert.equal(could({ early_access: { ...wire.early_access, status } }), false, status)
  }
})

test('no retention constant is exported for pages to show', () => {
  assert.equal('DISCOVERY_CLAIM_RETENTION_MONTHS' in require('./contract.ts'), false)
})
