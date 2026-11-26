// lib/entitlements/rollout-compat.test.cjs — Mixed versions during the Discovery Pass rollout: builds from before
// 20261021100000_discovery_pass.sql keep parsing the new summary, this build reads the old one, and a seven-day trial
// issued earlier is presented as the full access it still is. And free access until 30 December
// (20261126100000_free_until_30_december.sql): the plan read and the claim answers keep their shapes, and an answer this
// build does not know starts nothing. Run with lib/auth/test-loader.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { entitlementSummarySchema, freeMonthCouldBeClaimed } = require('./contract.ts')
const { accessNotice, unusedPreviews } = require('./presentation.ts')
const { claimRow, freeMonthEligibilityRow } = require('./service.ts')
const { preDiscoverySummarySchema } = require('./fixtures/pre-discovery-summary.cjs')

const NOW = '2026-10-30T12:00:00.000+00:00'
const hours = h => new Date(Date.parse(NOW) + h * 3_600_000).toISOString()
const early = { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null }

// get_my_entitlement() after 20261021100000, for each kind of trial a student can hold.
function discoveryDatabase(trial, access = null) {
  return { now: NOW, planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null, trial_hours: 72,
    trial_days: 3, expiry_notice_hours: 12, tier: access === null ? 'free' : 'full', access,
    trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null, ...trial },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] }, early_access: early, otp: null }
}
const pass = discoveryDatabase({ status: 'active', policy: 'discovery', starts_at: hours(-2), ends_at: hours(70) })
const sevenDay = discoveryDatabase({ status: 'active', policy: 'seven-day', starts_at: hours(-96), ends_at: hours(72) },
  { source: 'trial', ends_at: hours(72) })
const offered = discoveryDatabase({})

// get_my_entitlement() before 20261021100000: trial_days, no policy, no discovery.
const preDiscoveryDatabase = { now: NOW, planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null,
  trial_days: 7, expiry_notice_hours: 48, tier: 'full', access: { source: 'trial', ends_at: hours(72) },
  trial: { status: 'active', starts_at: hours(-96), ends_at: hours(72), available_from: null }, early_access: early,
  otp: null }

test('a build from before the Discovery Pass keeps parsing every summary the new database returns', () => {
  for (const [label, row] of [['a pass', pass], ['a seven-day trial', sevenDay], ['no trial yet', offered]]) {
    const parsed = preDiscoverySummarySchema.safeParse(row)
    assert.equal(parsed.success, true, `${label}: ${parsed.success ? '' : parsed.error.message}`)
  }
  const old = preDiscoverySummarySchema.parse(sevenDay)
  assert.deepEqual([old.tier, old.access.source], ['full', 'trial'], 'the seven-day trial is still full access there')
  assert.equal(preDiscoverySummarySchema.parse(pass).tier, 'free', 'and a pass is never full access there either')
  assert.equal(preDiscoverySummarySchema.parse(pass).trial_days, 3, 'trial_days is still a positive whole number')
})

test('this build reads the new database, including a seven-day trial issued before the pass', () => {
  const current = entitlementSummarySchema.parse(pass)
  assert.deepEqual([current.trial_hours, current.trial.policy, current.discovery.cbt_questions], [72, 'discovery', 50])
  assert.equal('trial_days' in current, false, 'one length field reaches the pages')
  assert.equal('otp' in current, false, 'the compatibility otp key (always null now) never reaches the pages')
  const legacy = entitlementSummarySchema.parse(sevenDay)
  assert.deepEqual([legacy.tier, legacy.access.source, legacy.trial.policy], ['full', 'trial', 'seven-day'])
  assert.equal(entitlementSummarySchema.parse(offered).trial.policy, null, 'no trial yet, no policy')
})

test('this build reads a database from before the migration without inventing a pass', () => {
  const parsed = entitlementSummarySchema.parse(preDiscoveryDatabase)
  assert.equal(parsed.trial_hours, 7 * 24, 'the length comes from trial_days')
  assert.equal(parsed.trial.policy, 'seven-day', 'every trial that database issued is a seven-day trial')
  assert.equal(parsed.discovery, null, 'and it offers no Discovery Pass')
  assert.deepEqual(unusedPreviews(parsed), [])
  const offeredThere = entitlementSummarySchema.parse({ ...preDiscoveryDatabase, tier: 'free', access: null,
    trial: { status: 'available', starts_at: null, ends_at: null, available_from: null } })
  assert.equal(offeredThere.trial.policy, null)
  assert.equal(accessNotice(offeredThere), null, 'no pass is advertised that the database would not issue')
  const { trial_days: _days, ...lengthless } = preDiscoveryDatabase
  assert.equal(entitlementSummarySchema.safeParse(lengthless).success, false, 'a summary with no length fails closed')
})

test('a seven-day trial is shown as the full access it is, never as a pass', () => {
  const ending = entitlementSummarySchema.parse({ ...sevenDay,
    access: { source: 'trial', ends_at: hours(5) }, trial: { ...sevenDay.trial, ends_at: hours(5) } })
  const notice = accessNotice(ending)
  assert.equal(notice.id, 'access-ending')
  assert.match(notice.title, /^Your plan ends \w{3}, \d+ \w{3} 2026, \d\d:\d\d\.$/)
  assert.equal(notice.body, 'After that, only GST courses stay free.')
  assert.doesNotMatch(notice.title + notice.body, /Discovery|pass|Free until|free access|data-free-month/i)
  assert.equal(accessNotice(entitlementSummarySchema.parse(sevenDay)), null, 'nothing to say mid-trial')
  const ended = entitlementSummarySchema.parse({ ...sevenDay, tier: 'free', access: null,
    trial: { ...sevenDay.trial, status: 'ended', ends_at: hours(-1) } })
  assert.equal(accessNotice(ended).title, 'Your free trial has ended.')
})

// ---- Free access until 30 December (20261126100000) -------------------------------------------------------------

// The close the launch stored, where every claim also ends: the end of 30 December in Lagos.
const CLOSES = '2026-12-30T23:00:00+00:00'
const USER = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'

test('the plan read keeps its shape: enrollment_closes_at is the stored close, and a key this build does not know is dropped', () => {
  // get_my_entitlement() on a launched database, 20 days after the launch: before 20261126100000 it answered the launch
  // plus 10 days here, and the pages stopped asking. The extra key stands for one a later database adds (another branch
  // replaces the same function).
  const launched = { ...discoveryDatabase({ status: 'not-offered' }), now: '2026-12-21T08:00:00+00:00',
    actual_launch_at: '2026-12-01T08:00:00+00:00', early_access: { ...early, enrollment_closes_at: CLOSES },
    a_key_from_a_later_database: { enabled: true } }
  const parsed = entitlementSummarySchema.parse(launched)
  assert.equal(parsed.early_access.enrollment_closes_at, CLOSES)
  assert.equal('a_key_from_a_later_database' in parsed, false, 'an unknown key is dropped, not refused')
  assert.equal(freeMonthCouldBeClaimed(parsed), true, 'the pages keep asking until the stored close')
  assert.equal(freeMonthCouldBeClaimed({ ...parsed, now: CLOSES }), false, 'and stop there')
  const old = preDiscoverySummarySchema.safeParse(launched)
  assert.equal(old.success, true, `the oldest build still parses it: ${old.success ? '' : old.error.message}`)
})

test('the claim answers keep their shapes, with the end and the close one instant', () => {
  // early_access_claim_eligibility(): ends_at (early_access_month_end) and closes_at are both the stored close.
  assert.deepEqual(freeMonthEligibilityRow.parse({ eligible: true, ends_at: CLOSES, closes_at: CLOSES }),
    { eligible: true, ends_at: CLOSES, closes_at: CLOSES })
  // claim_early_access(): a new claim and a replay of one both end there.
  assert.deepEqual(claimRow.parse({ state: 'claimed', starts_at: '2026-12-21T08:00:00+00:00', ends_at: CLOSES }),
    { state: 'claimed', starts_at: '2026-12-21T08:00:00+00:00', ends_at: CLOSES })
  assert.deepEqual(claimRow.parse({ state: 'already-claimed', ends_at: CLOSES, active: true }),
    { state: 'already-claimed', ends_at: CLOSES, active: true })
})

/** A free access claim through the real entry point (server.ts), against a database that answers `answer`. */
async function claimAgainst(answer) {
  const asked = []
  const service = { async rpc(name) {
    asked.push(name)
    if (name === 'consume_discovery_activation_limit') return { data: { allowed: true, origin_requests: 1 }, error: null }
    return { data: answer, error: null }
  } }
  const mocks = {
    '@supabase/supabase-js': { createClient: () => service },
    '@vercel/analytics/server': { track: async () => {} },
    '@/lib/auth/config': { getSupabaseConfig: () => ({ url: 'http://127.0.0.1:1' }), getAuthSecretKey: () => 'service-key',
      isStudentAuthEnabled: () => true },
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/auth/student-state': { getStudentSessionContext: async () => ({ user: { id: USER, email: 'student@example.test' },
      sessionId: SESSION }) },
    '@/lib/auth/account-continuity': { matchesAccountContinuityToken: () => true },
    '@/lib/auth/rate-limit': { getBucket: () => 'a'.repeat(64) },
  }
  const original = Module._load
  const keys = process.env.ENTITLEMENT_CLAIM_HASH_KEYS
  Module._load = function (name, ...args) {
    return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args)
  }
  process.env.ENTITLEMENT_CLAIM_HASH_KEYS = '1:first-secret-of-at-least-thirty-two-chars'
  try {
    delete require.cache[require.resolve('./server.ts')]
    const { runEntitlementRequest } = require('./server.ts')
    const result = await runEntitlementRequest({ action: 'claim-free-month', profileRevision: 3 }, { headers: new Headers() },
      'page-token', '203.0.113.7')
    return { result, asked }
  } finally {
    Module._load = original
    delete require.cache[require.resolve('./server.ts')]
    if (keys === undefined) delete process.env.ENTITLEMENT_CLAIM_HASH_KEYS
    else process.env.ENTITLEMENT_CLAIM_HASH_KEYS = keys
  }
}

test('a claim state this build does not know starts nothing: the student is told it is unavailable', async () => {
  // The same path with an answer it knows, so the refusal below is the answer's doing.
  assert.deepEqual((await claimAgainst({ state: 'claimed', starts_at: '2026-12-21T08:00:00+00:00', ends_at: CLOSES })).result,
    { status: 'month-started', endsAt: CLOSES })
  const unknown = { state: 'a-state-from-a-later-database', ends_at: CLOSES }
  assert.equal(claimRow.safeParse(unknown).success, false)
  const { result, asked } = await claimAgainst(unknown)
  assert.deepEqual(asked, ['consume_discovery_activation_limit', 'claim_early_access'], 'the database was asked and answered')
  assert.deepEqual(result, { status: 'unavailable' })
})
