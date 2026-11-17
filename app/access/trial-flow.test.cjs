// app/access/trial-flow.test.cjs — Every result of starting a free pass or claiming a free month has specific, safe copy
// and a next step.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeFreeMonthResult, describeResult, PASS_REFUSED } = require('./trial-flow.ts')

const SAMPLES = {
  'pass-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'already-activated': { endsAt: '2026-10-29T09:00:00.000Z' },
  'early-access-active': { availableFrom: '2026-11-25T09:00:00.000Z' },
  'already-claimed': {},
}
const STATUSES = ['pass-activated', 'already-activated', 'already-claimed', 'early-access-active', 'trial-not-offered',
  'rate-limited', 'capacity', 'signed-out', 'session-changed', 'invalid-request', 'unavailable', 'selection-changed']

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
  assert.equal(PASS_REFUSED, 'A free pass isn’t available on this account. Free GST courses are still open to you.')
  for (const result of [{ status: 'already-claimed' }, { status: 'already-claimed', retentionMonths: 60 },
    { status: 'trial-not-offered' }, { status: 'early-access-active', availableFrom: '2026-11-25T09:00:00.000Z' }]) {
    const { message, next } = describeResult(result)
    assert.equal(next, 'close', JSON.stringify(result))
    assert.equal(message.text, PASS_REFUSED, JSON.stringify(result))
  }
})

test('a pass refused because the courses changed in another tab says so and reloads the plan (D7)', () => {
  assert.deepEqual(describeResult({ status: 'selection-changed' }), { next: 'refresh',
    message: { tone: 'error', text: 'Your courses were just updated.' } })
})

test('a started pass says so in the approved words', () => {
  assert.equal(describeResult({ status: 'invalid-request' }).message.text, 'Something went wrong. Try again.')
  assert.equal(describeResult({ status: 'pass-activated', endsAt: 'x' }).message.text, 'Your free pass has started.')
  assert.equal(describeResult({ status: 'already-activated', endsAt: 'x' }).message.text, 'You’ve already used your free pass.')
})

test('the free month: started needs no words; the claim closing or the account not qualifying ends the offer with one line and no reason', () => {
  assert.deepEqual(describeFreeMonthResult({ status: 'month-started', endsAt: '2026-12-16T13:30:00+00:00' }),
    { next: 'started', message: null })
  assert.deepEqual(describeFreeMonthResult({ status: 'offer-ended' }),
    { next: 'close', message: { tone: 'info', text: 'This offer has ended.' } })
  assert.deepEqual(describeFreeMonthResult({ status: 'offer-unavailable' }),
    { next: 'close', message: { tone: 'info', text: 'A free month isn’t available on this account.' } })
})

test('the free month: anything that started nothing says "Couldn’t start your free month. Try again." and stays open', () => {
  // Faults, and any free pass answer (which this command never produces): nothing is assumed to have started.
  for (const result of [{ status: 'unavailable' }, { status: 'capacity' }, { status: 'invalid-request' },
    { status: 'pass-activated', endsAt: 'x' }, { status: 'already-activated', endsAt: 'x' }, { status: 'already-claimed' },
    { status: 'trial-not-offered' }, { status: 'early-access-active', availableFrom: 'x' }]) {
    assert.deepEqual(describeFreeMonthResult(result),
      { next: 'stay', message: { tone: 'error', text: 'Couldn’t start your free month. Try again.' } }, result.status)
  }
  assert.deepEqual(describeFreeMonthResult({ status: 'rate-limited' }),
    { next: 'stay', message: { tone: 'error', text: 'Too many attempts. Please wait a few minutes and try again.' } })
})

test('the free month: a changed sign-in or changed courses reload the page, and no message names an address or a reason', () => {
  assert.deepEqual(describeFreeMonthResult({ status: 'selection-changed' }),
    { next: 'refresh', message: { tone: 'error', text: 'Your courses were just updated.' } })
  assert.deepEqual(describeFreeMonthResult({ status: 'signed-out' }),
    { next: 'refresh', message: { tone: 'error', text: 'You’ve been signed out.' } })
  assert.equal(describeFreeMonthResult({ status: 'session-changed' }).next, 'refresh')
  for (const status of [...STATUSES, 'month-started', 'offer-ended', 'offer-unavailable']) {
    const { message, next } = describeFreeMonthResult({ status, ...SAMPLES[status] })
    assert.ok(['stay', 'refresh', 'started', 'close'].includes(next), status)
    if (message === null) { assert.equal(status, 'month-started'); continue }
    assert.doesNotMatch(message.text, /@|email|address|already|used|paid|domain|Early Access|window|\d{4}/i, `${status}: no reason`)
  }
})
