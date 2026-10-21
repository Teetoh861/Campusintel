// app/access/trial-flow.test.cjs — Every activation result has specific, safe copy and a next step.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeResult } = require('./trial-flow.ts')

const SAMPLES = {
  'pass-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'already-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'early-access-active': { availableFrom: '2026-11-25T09:00:00.000Z' },
}
const STATUSES = ['pass-activated', 'already-activated', 'already-claimed', 'early-access-active', 'trial-not-offered',
  'rate-limited', 'capacity', 'signed-out', 'session-changed', 'invalid-request', 'unavailable']

test('every status is described and never echoes an address, a phone number, a code or another account', () => {
  for (const status of STATUSES) {
    const { message, next } = describeResult({ status, ...SAMPLES[status] })
    assert.ok(message && message.text.length > 0, status)
    assert.ok(['stay', 'refresh'].includes(next), status)
    assert.doesNotMatch(message.text, /@|\+234|\d{6}|phone|SMS|code/i, status)
  }
})

test('success and a replay refresh the server-rendered plan; refusals stay put with an honest reason', () => {
  assert.equal(describeResult({ status: 'pass-activated', endsAt: 'x' }).next, 'refresh')
  assert.equal(describeResult({ status: 'already-activated', endsAt: 'x' }).next, 'refresh')
  const claimed = describeResult({ status: 'already-claimed' })
  assert.equal(claimed.next, 'stay')
  assert.match(claimed.message.text, /already had a Discovery Pass/)
  assert.match(claimed.message.text, /GST courses stay free/)
  assert.equal(describeResult({ status: 'rate-limited' }).next, 'stay')
  assert.match(describeResult({ status: 'rate-limited' }).message.text, /wait a few minutes/)
  assert.equal(describeResult({ status: 'capacity' }).next, 'stay')
})

test('during Early Access the student learns when the pass opens', () => {
  const { message, next } = describeResult({ status: 'early-access-active', availableFrom: '2026-11-25T09:00:00.000Z' })
  assert.equal(next, 'refresh')
  assert.match(message.text, /25 Nov 2026/)
})
