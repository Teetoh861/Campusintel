// lib/entitlements/rollout-compat.test.cjs — Mixed versions during the Discovery Pass rollout: builds from before
// 20261021100000_discovery_pass.sql keep parsing the new summary, this build reads the old one, and a seven-day trial
// issued earlier is presented as the full access it still is.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { entitlementSummarySchema } = require('./contract.ts')
const { accessNotice, unusedPreviews } = require('./presentation.ts')
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
  assert.match(notice.body, /Free trial ends/)
  assert.doesNotMatch(notice.body, /Discovery/)
  assert.equal(accessNotice(entitlementSummarySchema.parse(sevenDay)), null, 'nothing to say mid-trial')
  const ended = entitlementSummarySchema.parse({ ...sevenDay, tier: 'free', access: null,
    trial: { ...sevenDay.trial, status: 'ended', ends_at: hours(-1) } })
  assert.equal(accessNotice(ended).title, 'Your free trial has ended')
})
