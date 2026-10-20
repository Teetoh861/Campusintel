// lib/entitlements/presentation.test.cjs — The one access notice: expiry warning, ended trial, Early Access waiting and the
// trial offer, all decided from the database clock.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { accessNotice, formatAccessDate } = require('./presentation.ts')

const NOW = '2026-10-30T12:00:00.000Z'
const hours = h => new Date(Date.parse(NOW) + h * 3_600_000).toISOString()

function summary(overrides = {}) {
  return {
    now: NOW, planned_launch_at: '2026-10-24T23:00:00.000Z', actual_launch_at: null, trial_days: 7,
    expiry_notice_hours: 48, tier: 'free', access: null,
    trial: { status: 'available', starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null },
    otp: null,
    ...overrides,
  }
}

test('a new student is offered the trial and told GST stays free', () => {
  const notice = accessNotice(summary())
  assert.equal(notice.id, 'trial-available')
  assert.match(notice.body, /7-day free trial/)
  assert.match(notice.body, /GST/)
})

test('a trial ending inside the notice window warns before department content restricts', () => {
  const ending = summary({ tier: 'full', access: { source: 'trial', ends_at: hours(20) },
    trial: { status: 'active', starts_at: hours(-148), ends_at: hours(20) } })
  const notice = accessNotice(ending)
  assert.equal(notice.id, 'access-ending')
  assert.equal(notice.title, 'Your free trial ends soon')
  assert.match(notice.body, /Department courses lock/)
  assert.equal(accessNotice({ ...ending, access: { source: 'trial', ends_at: hours(49) } }), null, 'quiet outside the window')
  const early = accessNotice({ ...ending, access: { source: 'early_access', ends_at: hours(5) } })
  assert.equal(early.title, 'Your full access ends soon')
})

test('an ended trial explains the free plan for two weeks, then goes quiet', () => {
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
  const trialEnding = summary({ tier: 'full', access: { source: 'trial', ends_at: hours(2) },
    early_access: { ...summary().early_access, status: 'awaiting-launch' } })
  assert.equal(accessNotice(trialEnding).id, 'access-ending', 'an expiry warning still comes first')
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
