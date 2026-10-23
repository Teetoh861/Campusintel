// app/access/trial-flow.test.cjs — Every activation result has specific, safe copy and a next step.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeResult, PASS_REFUSED } = require('./trial-flow.ts')

const SAMPLES = {
  'pass-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'already-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'early-access-active': { availableFrom: '2026-11-25T09:00:00.000Z' },
  'already-claimed': {},
}
const STATUSES = ['pass-activated', 'already-activated', 'already-claimed', 'early-access-active', 'trial-not-offered',
  'rate-limited', 'capacity', 'signed-out', 'session-changed', 'invalid-request', 'unavailable']

test('every status is described and never echoes an address, a phone number, a code or another account', () => {
  for (const status of STATUSES) {
    const { message, next } = describeResult({ status, ...SAMPLES[status] })
    assert.ok(message && message.text.length > 0, status)
    assert.ok(['stay', 'refresh', 'close'].includes(next), status)
    assert.doesNotMatch(message.text, /@|\+234|\d{6}|phone|SMS|code/i, status)
    assert.doesNotMatch(message.text, /email|address|months?\b|years?\b|Early Access/i, `${status}: no refusal reason`)
  }
})

test('success and a replay refresh the server-rendered plan; passing refusals stay put so the student can retry', () => {
  assert.equal(describeResult({ status: 'pass-activated', endsAt: 'x' }).next, 'refresh')
  assert.equal(describeResult({ status: 'already-activated', endsAt: 'x' }).next, 'refresh')
  assert.equal(describeResult({ status: 'rate-limited' }).next, 'stay')
  assert.match(describeResult({ status: 'rate-limited' }).message.text, /wait a few minutes/)
  assert.equal(describeResult({ status: 'capacity' }).next, 'stay')
})

test('every refusal of this account closes the offer with the one approved sentence and no reason', () => {
  assert.equal(PASS_REFUSED, 'Discovery Pass isn’t available on this account. Free GST courses are still open to you.')
  for (const result of [{ status: 'already-claimed' }, { status: 'already-claimed', retentionMonths: 60 },
    { status: 'trial-not-offered' }, { status: 'early-access-active', availableFrom: '2026-11-25T09:00:00.000Z' }]) {
    const { message, next } = describeResult(result)
    assert.equal(next, 'close', JSON.stringify(result))
    assert.equal(message.text, PASS_REFUSED, JSON.stringify(result))
  }
})
