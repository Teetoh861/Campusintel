// lib/entitlements/presentation.test.cjs — The one access notice: expiry warning, the Discovery Pass (offer, active, ending,
// ended) and Early Access waiting, all decided from the database clock.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { accessNotice, formatAccessDate, unusedPreviews } = require('./presentation.ts')

const NOW = '2026-10-30T12:00:00.000Z'
const hours = h => new Date(Date.parse(NOW) + h * 3_600_000).toISOString()

function summary(overrides = {}) {
  return {
    now: NOW, planned_launch_at: '2026-10-24T23:00:00.000Z', actual_launch_at: null, trial_hours: 72,
    expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'available', starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    // As the server's eligibility read left it.
    discovery_eligible: true,
    ...overrides,
  }
}

test('a new student is offered the Discovery Pass and told GST stays free', () => {
  const notice = accessNotice(summary())
  assert.equal(notice.id, 'trial-available')
  assert.match(notice.body, /72-hour Discovery Pass/)
  assert.match(notice.body, /one full 50-question CBT exam and one complete study guide topic/)
  assert.doesNotMatch(notice.body, /theory/i)
  assert.match(notice.body, /GST/)
  assert.doesNotMatch(notice.body, /7-day|full access/i)
})

const active = (endsIn, previews = []) => summary({ trial: { status: 'active', starts_at: hours(endsIn - 72),
  ends_at: hours(endsIn), available_from: null }, discovery: { ...summary().discovery, previews } })

test('a student who is not eligible is offered nothing and told no reason', () => {
  assert.equal(accessNotice(summary({ discovery_eligible: false })), null)
  for (const status of ['not-offered', 'after-early-access']) {
    assert.equal(accessNotice(summary({ trial: { status, starts_at: null, ends_at: null, available_from: hours(24) } })), null, status)
  }
})

test('an active pass is never presented as full access and lists only the previews still unused', () => {
  const fresh = accessNotice(active(30))
  assert.equal(fresh.id, 'discovery-active')
  assert.match(fresh.body, /CBT exam and study guide topic/)
  const used = active(30, [{ kind: 'cbt', content_key: 'business-statistics', submitted: true }])
  assert.deepEqual(unusedPreviews(used), ['study_guide'])
  assert.doesNotMatch(accessNotice(used).body, /CBT/)
  const all = active(30, ['cbt', 'study_guide'].map(kind => ({ kind, content_key: 'x', submitted: false })))
  assert.doesNotMatch(accessNotice(all).body, /Still to use/)
})

test('the ending warning follows the server clock and window, not the viewer', () => {
  assert.equal(accessNotice(active(11)).id, 'discovery-ending')
  assert.equal(accessNotice(active(11)).title, 'Your Discovery Pass ends soon')
  assert.equal(accessNotice(active(13)).id, 'discovery-active', 'outside the 12-hour window')
  const ending = summary({ tier: 'full', access: { source: 'early_access', ends_at: hours(5) } })
  assert.equal(accessNotice(ending).title, 'Your full access ends soon')
})

test('an ended pass explains the free plan for two weeks, then goes quiet', () => {
  const ended = trialEnd => summary({ trial: { status: 'ended', starts_at: null, ends_at: trialEnd } })
  assert.equal(accessNotice(ended(hours(-1))).id, 'trial-ended')
  assert.equal(accessNotice(ended(hours(-14 * 24 + 1))).id, 'trial-ended')
  assert.equal(accessNotice(ended(hours(-15 * 24))), null)
})

test('a listed member before the actual launch is told it starts automatically, with no date promised', () => {
  const waiting = accessNotice(summary({ early_access: { ...summary().early_access, status: 'awaiting-launch' } }))
  assert.equal(waiting.id, 'early-access-awaiting-launch')
  assert.match(waiting.body, /automatically when CampusIntell launches publicly/)
  assert.match(waiting.body, /nothing to claim/)
  assert.doesNotMatch(waiting.body, /\d{4}|Oct|claim by/i, 'the planned date is never presented as a start date')
  const fullEnding = summary({ tier: 'full', access: { source: 'manual', ends_at: hours(2) },
    early_access: { ...summary().early_access, status: 'awaiting-launch' } })
  assert.equal(accessNotice(fullEnding).id, 'access-ending', 'an expiry warning still comes first')
})

test('during Early Access only its own ending is announced; the trial is not offered as available', () => {
  const active = summary({ tier: 'full', access: { source: 'early_access', ends_at: hours(24 * 20) },
    trial: { status: 'after-early-access', starts_at: null, ends_at: null, available_from: hours(24 * 20) },
    early_access: { status: 'active', starts_at: hours(-24 * 10), ends_at: hours(24 * 20), enrollment_closes_at: null } })
  assert.equal(accessNotice(active), null)
  assert.equal(accessNotice({ ...active, access: { source: 'early_access', ends_at: hours(10) } }).title,
    'Your full access ends soon')
})

test('dates are shown in Lagos time regardless of the server timezone', () => {
  assert.equal(formatAccessDate('2026-10-24T23:00:00.000Z'), 'Sun, 25 Oct 2026, 00:00 (Lagos)')
  assert.equal(formatAccessDate('not a date'), '')
})

test('regression F4: trial wording follows the student\'s own grant policy, on databases before and after the pass', () => {
  const { trialWording, trialGrantName } = require('./presentation.ts')
  const { entitlementSummarySchema } = require('./contract.ts')
  const base = { now: NOW, planned_launch_at: '2026-10-24T23:00:00.000Z', actual_launch_at: null, expiry_notice_hours: 12,
    tier: 'free', access: null, early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } }
  const sevenDay = status => ({ status, starts_at: hours(-96), ends_at: status === 'active' ? hours(72) : hours(-24), available_from: null })
  // A database from before the pass: trial_days only, no policy on the wire, no discovery.
  const before = status => entitlementSummarySchema.parse({ ...base, trial_days: 7, trial: sevenDay(status),
    ...(status === 'active' ? { tier: 'full', access: { source: 'trial', ends_at: hours(72) } } : {}) })
  // A database with the pass, answering for a seven-day trial it backfilled with its policy.
  const after = status => entitlementSummarySchema.parse({ ...base, trial_hours: 72, trial: { ...sevenDay(status), policy: 'seven-day' },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    ...(status === 'active' ? { tier: 'full', access: { source: 'trial', ends_at: hours(72) } } : {}) })
  for (const [label, read] of [['before the migration', before], ['after the migration', after]]) {
    for (const status of ['active', 'ended']) {
      assert.deepEqual(trialWording(read(status)), { policy: 'seven-day', passAvailable: false }, `${label}, ${status}`)
      assert.equal(trialGrantName(trialWording(read(status)).policy), 'free trial', `${label}, ${status}: never a Discovery Pass`)
    }
  }
  const pass = entitlementSummarySchema.parse({ ...base, trial_hours: 72, discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    trial: { status: 'active', policy: 'discovery', starts_at: hours(-1), ends_at: hours(71), available_from: null } })
  assert.deepEqual(trialWording(pass), { policy: 'discovery', passAvailable: false })
  assert.equal(trialGrantName('discovery'), 'Discovery Pass')
  const offered = entitlementSummarySchema.parse({ ...base, trial_hours: 72, discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null } })
  assert.deepEqual(trialWording(offered), { policy: null, passAvailable: false }, 'no pass before the server reads eligibility')
  assert.deepEqual(trialWording({ ...offered, discovery_eligible: true }), { policy: null, passAvailable: true },
    'a pass can be started only by an eligible account without a trial')
  const notOfferedHere = entitlementSummarySchema.parse({ ...base, trial_days: 7,
    trial: { status: 'available', starts_at: null, ends_at: null, available_from: null } })
  assert.deepEqual(trialWording(notOfferedHere), { policy: null, passAvailable: false }, 'a pre-pass database offers no pass')
  assert.deepEqual([trialWording(null), trialWording(undefined)], [{ policy: null, passAvailable: false }, { policy: null, passAvailable: false }])
  assert.equal(trialGrantName(null), 'trial access', 'without policy data the wording is neutral')
})
