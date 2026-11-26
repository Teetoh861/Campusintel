// lib/entitlements/presentation.test.cjs — The one access notice: the ending of a plan or of free access (by its
// name, and by its last day when it ends at a Lagos midnight), and the free pass (offer, active, ending, ended), all
// decided from the database clock. Free access is offered by its own card, never by this notice, and nothing is said
// about the retired list.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { accessNotice, formatAccessDate, formatFreeMonthDay, unusedPreviews } = require('./presentation.ts')

const NOW = '2026-10-30T12:00:00.000Z'
const hours = h => new Date(Date.parse(NOW) + h * 3_600_000).toISOString()
// Where every claim ends (20261126100000): the end of 30 December in Lagos, the exclusive midnight after that day.
const FREE_ACCESS_ENDS = '2026-12-30T23:00:00.000Z'

function summary(overrides = {}) {
  return {
    now: NOW, planned_launch_at: '2026-10-24T23:00:00.000Z', actual_launch_at: null, trial_hours: 72,
    expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'available', starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    // As the server's eligibility read left it.
    discovery_eligible: true,
    // No paid plan and no free month on offer, as the contract fills them in.
    paid: null, free_month: null,
    ...overrides,
  }
}

test('a new student is offered the free pass in the one offer wording; what it includes stays in the modal', () => {
  const notice = accessNotice(summary())
  assert.deepEqual([notice.id, notice.title, notice.body, notice.action],
    ['trial-available', 'Free pass', 'Try your department courses free for 3 days.', 'Get your free pass'],
    'a label as the title, so no full stop; the sentence under it keeps its own')
  assert.equal(accessNotice(summary({ plans_on_sale: true })).body, 'Try your department courses free for 3 days.')
  assert.doesNotMatch(notice.body, /Discovery|72|hour|CBT|topic|7-day|full access/i)
})

const active = (endsIn, previews = []) => summary({ trial: { status: 'active', starts_at: hours(endsIn - 72),
  ends_at: hours(endsIn), available_from: null }, discovery: { ...summary().discovery, previews } })

test('a student who is not eligible is offered nothing and told no reason', () => {
  assert.equal(accessNotice(summary({ discovery_eligible: false })), null)
  for (const status of ['not-offered', 'after-early-access']) {
    assert.equal(accessNotice(summary({ trial: { status, starts_at: null, ends_at: null, available_from: hours(24) } })), null, status)
  }
})

test('an active pass is never presented as full access and shows its end time only, in one line', () => {
  const fresh = accessNotice(active(30))
  assert.deepEqual([fresh.id, fresh.title, fresh.body], ['discovery-active', 'Your free pass ends Sat, 31 Oct 2026, 19:00.', ''])
  const used = active(30, [{ kind: 'cbt', content_key: 'business-statistics', submitted: true }])
  assert.deepEqual(unusedPreviews(used), ['study_guide'])
  for (const notice of [fresh, accessNotice(used)]) {
    assert.doesNotMatch(notice.title + notice.body, /CBT|topic|Still to use|full access|left|active/i)
    assert.equal(notice.action, 'View your plan')
  }
})

test('the ending warning follows the server clock and window, not the viewer', () => {
  assert.equal(accessNotice(active(11)).id, 'discovery-ending')
  assert.equal(accessNotice(active(11)).title, 'Your free pass ends Sat, 31 Oct 2026, 00:00.')
  assert.equal(accessNotice(active(13)).id, 'discovery-active', 'outside the 12-hour window')
  // Each full access by what the student calls it: free access by name, anything else as their plan. An end that is not
  // a Lagos midnight (a claim made before every claim ended on 30 December) keeps its date and time.
  const ending = source => accessNotice(summary({ tier: 'full', access: { source, ends_at: hours(5) } }))
  assert.deepEqual([ending('early_access').title, ending('early_access').body],
    ['Your free access ends Fri, 30 Oct 2026, 18:00.', 'After that, only GST courses stay free.'])
  for (const source of ['paid', 'manual', 'trial']) {
    assert.deepEqual([ending(source).id, ending(source).title, ending(source).body],
      ['access-ending', 'Your plan ends Fri, 30 Oct 2026, 18:00.', 'After that, only GST courses stay free.'], source)
  }
  // A Session plan whose Second Semester is already set does not end with its first half.
  assert.equal(accessNotice(summary({ tier: 'full', access: { source: 'paid', ends_at: hours(5) },
    paid: { second_ends_at: hours(24 * 150) } })), null)
  // The same summary read a day earlier by the database's clock says nothing yet, whatever the device says.
  assert.equal(accessNotice({ ...summary({ tier: 'full', access: { source: 'early_access', ends_at: hours(5) } }),
    now: hours(-24) }), null)
})

test('an ended pass explains the free plan for two weeks, then goes quiet', () => {
  const ended = trialEnd => summary({ trial: { status: 'ended', starts_at: null, ends_at: trialEnd } })
  assert.equal(accessNotice(ended(hours(-1))).id, 'trial-ended')
  assert.equal(accessNotice(ended(hours(-14 * 24 + 1))).id, 'trial-ended')
  assert.equal(accessNotice(ended(hours(-15 * 24))), null)
})

test('there is no list: a place an older database still reports is announced nowhere, and promises nothing', () => {
  for (const status of ['awaiting-launch', 'pending', 'enrollment-closed', 'unavailable']) {
    const listed = summary({ discovery_eligible: false, early_access: { ...summary().early_access, status } })
    assert.equal(accessNotice(listed), null, status)
  }
  const fullEnding = summary({ tier: 'full', access: { source: 'manual', ends_at: hours(2) },
    early_access: { ...summary().early_access, status: 'awaiting-launch' } })
  assert.equal(accessNotice(fullEnding).id, 'access-ending', 'an expiry warning is unaffected')
})

test('free access is offered by its own card, never by this notice, and its claim window adds no notice', () => {
  // The claim closes where every claim ends.
  const claimable = summary({ actual_launch_at: hours(-24), discovery_eligible: false,
    free_month: { endsAt: FREE_ACCESS_ENDS, closesAt: FREE_ACCESS_ENDS },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: FREE_ACCESS_ENDS } })
  assert.equal(accessNotice(claimable), null)
  assert.equal(accessNotice({ ...claimable, now: '2026-12-30T22:00:00.000Z' }), null,
    'nor in its last hours: the ending notice is for a student who has free access')
  const closed = summary({ now: '2026-12-31T08:00:00.000Z', actual_launch_at: hours(-24), discovery_eligible: false,
    free_month: null, early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: FREE_ACCESS_ENDS } })
  assert.equal(accessNotice(closed), null, 'nothing says the offer closed')
})

test('during free access only its own ending is announced, by name; the pass is not offered beside it', () => {
  const active = summary({ tier: 'full', access: { source: 'early_access', ends_at: hours(24 * 20) },
    trial: { status: 'after-early-access', starts_at: null, ends_at: null, available_from: hours(24 * 20) },
    early_access: { status: 'active', starts_at: hours(-24 * 10), ends_at: hours(24 * 20), enrollment_closes_at: null } })
  assert.equal(accessNotice(active), null)
  const ending = accessNotice({ ...active, access: { source: 'early_access', ends_at: hours(10) } })
  assert.deepEqual([ending.id, ending.title, ending.body, ending.action],
    ['access-ending', 'Your free access ends Fri, 30 Oct 2026, 23:00.', 'After that, only GST courses stay free.', 'View your plan'])
  assert.doesNotMatch(ending.title + ending.body, /Early Access|full access|soon/i)
  // After it has ended nothing is announced here: Plan & Access says it once.
  const ended = summary({ discovery_eligible: false, trial: { status: 'not-offered', starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'ended', starts_at: hours(-24 * 31), ends_at: hours(-24), enrollment_closes_at: null } })
  assert.equal(accessNotice(ended), null)
})

test('free access ending at a Lagos midnight names its last day, never the next: "midnight tonight" or "the end of" it', () => {
  // A holder on the database clock: claimed after the launch, ending with every claim at the end of 30 December.
  const holder = (now, change = {}) => summary({ now, tier: 'full', discovery_eligible: false,
    access: { source: 'early_access', ends_at: FREE_ACCESS_ENDS },
    trial: { status: 'not-offered', starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'active', starts_at: '2026-12-01T08:00:00.000Z', ends_at: FREE_ACCESS_ENDS,
      enrollment_closes_at: FREE_ACCESS_ENDS }, ...change })
  const tonight = accessNotice(holder('2026-12-30T12:00:00.000Z'))
  assert.deepEqual(tonight, { id: 'access-ending', tone: 'info', title: 'Your free access ends at midnight tonight.',
    body: 'After that, only GST courses stay free.', action: 'View your plan' }, '13:00 on 30 December in Lagos: 11 hours left')
  assert.equal(accessNotice(holder('2026-12-30T22:59:59.999Z')).title, 'Your free access ends at midnight tonight.',
    'its last moment')
  assert.equal(accessNotice(holder('2026-12-30T10:59:59.000Z')), null, 'one second outside the 12-hour window: nothing yet')
  assert.equal(accessNotice(holder(FREE_ACCESS_ENDS)), null, 'nothing once it has ended')
  // Only a notice window longer than a day can show it on an earlier day: then it names the last day.
  const earlier = accessNotice(holder('2026-12-29T12:00:00.000Z', { expiry_notice_hours: 48 }))
  assert.equal(earlier.title, 'Your free access ends at the end of Wed, 30 Dec 2026.')
  for (const notice of [tonight, earlier]) {
    assert.doesNotMatch(notice.title + notice.body, /31|Thu|00:00|month/, 'never the next day, its midnight, or a month')
  }
  // A plan that ends at a Lagos midnight is unchanged: its date and time.
  const semesterEnd = '2027-03-08T23:00:00.000Z'
  for (const source of ['paid', 'manual']) {
    const plan = accessNotice(summary({ now: '2027-03-08T12:00:00.000Z', tier: 'full', access: { source, ends_at: semesterEnd } }))
    assert.deepEqual([plan.id, plan.title], ['access-ending', `Your plan ends ${formatAccessDate(semesterEnd)}.`], source)
  }
})

test('dates are shown in Lagos time regardless of the server timezone, and without the zone\'s name', () => {
  assert.equal(formatAccessDate('2026-10-24T23:00:00.000Z'), 'Sun, 25 Oct 2026, 00:00')
  assert.equal(formatAccessDate('not a date'), '')
  // The last Lagos day free access covers: the day and month, with no year. Ends are exclusive instants, so an end at
  // Lagos midnight names the day before it.
  assert.equal(formatFreeMonthDay('2026-12-30T23:00:00Z'), '30 December', 'the end of 30 December, where every claim ends')
  assert.equal(formatFreeMonthDay('2026-12-30T22:59:59.999Z'), '30 December')
  assert.equal(formatFreeMonthDay('2026-12-16T13:30:00Z'), '16 December', 'an end during a day names that day')
  assert.equal(formatFreeMonthDay('2026-12-16T23:00:00Z'), '16 December', 'Lagos midnight names the day it ends, not the next')
  assert.equal(formatFreeMonthDay('not a date'), '')
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
      assert.equal(trialGrantName(trialWording(read(status)).policy), 'free trial', `${label}, ${status}: never a free pass`)
    }
  }
  const pass = entitlementSummarySchema.parse({ ...base, trial_hours: 72, discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    trial: { status: 'active', policy: 'discovery', starts_at: hours(-1), ends_at: hours(71), available_from: null } })
  assert.deepEqual(trialWording(pass), { policy: 'discovery', passAvailable: false })
  assert.equal(trialGrantName('discovery'), 'free pass')
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

test('the free access claim for a page: the database end as its last day, and the time left until the claim closes on the database clock', () => {
  const { freeMonthClaim } = require('./presentation.ts')
  // The eligibility read answers one instant for both: the end of 30 December, Lagos.
  const offer = { endsAt: FREE_ACCESS_ENDS, closesAt: FREE_ACCESS_ENDS }
  const readAt = now => summary({ now, free_month: offer })
  assert.deepEqual(freeMonthClaim(readAt('2026-12-30T12:00:00.000Z'), 'page-token', 7),
    { continuityToken: 'page-token', profileRevision: 7, endsOn: '30 December', closesInMs: 11 * 3_600_000 },
    'the closing instant less the database\'s own now (13:00 in Lagos), never the device clock')
  assert.equal(freeMonthClaim(readAt('2026-12-01T08:00:00.000Z'), 'page-token', 7).closesInMs, 2_559_600_000,
    'read at 09:00 in Lagos on 1 December: 29 days and 15 hours')
  assert.equal(freeMonthClaim(readAt('2026-12-30T12:00:00.000Z'), 'page-token', null), null, 'never without the revision (D7)')
  assert.equal(freeMonthClaim(summary(), 'page-token', 7), null, 'nothing when the database offers no claim')
  assert.equal(freeMonthClaim(readAt('2026-12-30T23:00:01.000Z'), 't', 7).closesInMs, 0,
    'a claim that closed before the read leaves no time, never a negative delay')
  assert.equal(freeMonthClaim(summary({ free_month: { ...offer, closesAt: 'not a time' } }), 't', 7).closesInMs, 0)
})
