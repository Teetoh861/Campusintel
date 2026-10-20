// app/access/trial-flow.test.cjs — Every activation result has specific, safe copy and a next step.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeResult } = require('./trial-flow.ts')

const SAMPLES = {
  'code-sent': { challengeId: '11111111-1111-4111-8111-111111111111', phoneHint: '567', expiresAt: 'x', resendAt: 'y' },
  'delivery-failed': { challengeId: '11111111-1111-4111-8111-111111111111', phoneHint: '567', resendAt: 'y' },
  'cooldown': { retryAt: '2026-10-26T09:01:00.000Z' },
  'rate-limited': { retryAt: '2026-10-26T10:00:00.000Z' },
  'incorrect': { attemptsLeft: 2 },
  'trial-activated': { endsAt: 'x' },
  'early-access-active': { availableFrom: '2026-11-25T09:00:00.000Z' },
}
const STATUSES = ['code-sent', 'delivery-failed', 'cooldown', 'rate-limited', 'incorrect', 'trial-activated',
  'early-access-active', 'signed-out', 'session-changed', 'invalid-request', 'invalid-phone', 'unavailable', 'capacity',
  'already-activated', 'phone-already-used', 'expired', 'superseded', 'already-used', 'too-many-attempts',
  'trial-not-offered']

test('every status is described and never echoes a number, code or other account', () => {
  for (const status of STATUSES) {
    const { message, next } = describeResult({ status, ...SAMPLES[status] })
    assert.ok(message && message.text.length > 0, status)
    assert.ok(['stay', 'restart', 'refresh'].includes(next), status)
    assert.doesNotMatch(message.text, /@|\+234|\d{6}/, status)
  }
})

test('success refreshes the server-rendered plan; dead codes restart; a delivery failure keeps the resend path', () => {
  assert.equal(describeResult({ status: 'trial-activated', endsAt: 'x' }).next, 'refresh')
  for (const status of ['expired', 'superseded', 'too-many-attempts', 'phone-already-used']) {
    assert.equal(describeResult({ status }).next, 'restart', status)
  }
  const failed = describeResult({ status: 'delivery-failed', ...SAMPLES['delivery-failed'] })
  assert.equal(failed.next, 'stay')
  assert.match(failed.message.text, /never uses up your pass/)
  assert.match(describeResult({ status: 'incorrect', attemptsLeft: 1 }).message.text, /1 attempt left/)
  assert.match(describeResult({ status: 'cooldown', retryAt: '2026-10-26T09:01:00.000Z' }).message.text, /10:01/)
})

test('during Early Access the student learns when the trial opens', () => {
  const { message, next } = describeResult({ status: 'early-access-active', availableFrom: '2026-11-25T09:00:00.000Z' })
  assert.equal(next, 'refresh')
  assert.match(message.text, /25 Nov 2026/)
})
