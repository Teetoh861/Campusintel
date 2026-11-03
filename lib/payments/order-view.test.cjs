// lib/payments/order-view.test.cjs — How the return page reads our order endpoint (strictly: anything unexpected is
// unavailable, never paid), the payment paths, and where a saved course selection may send the student back to.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readOrderAnswer } = require('./order-view.ts')
const { checkoutHref, CHECKOUT_PATH, PAYMENT_TERMS_PATH, RECEIPTS_PATH } = require('./paths.ts')
const { selectionReturnPath, profileSelectionHref } = require('../profile/paths.ts')

const ORDER = '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'
const order = { state: 'paid', order_id: ORDER, plan: 'standard_semester', tier: 'standard', period: 'semester',
  amount_kobo: 400000, created_at: '2026-11-03T10:00:00Z', paid_at: '2026-11-03T10:01:00Z', ends_at: null,
  second_starts_at: null, second_ends_at: null }

test('an order answer is read strictly: only a well-formed order of ours is an order', () => {
  assert.deepEqual(readOrderAnswer(200, order), { kind: 'order', order })
  assert.deepEqual(readOrderAnswer(401, null), { kind: 'signed-out' })
  assert.deepEqual(readOrderAnswer(404, order), { kind: 'not-found' })
  assert.deepEqual(readOrderAnswer(200, { state: 'not-found' }), { kind: 'not-found' })
  for (const body of [null, 'paid', { ...order, state: 'success' }, { ...order, order_id: 'x' }, { ...order, amount_kobo: 0 },
    { ...order, plan: 'gold' }]) {
    assert.deepEqual(readOrderAnswer(200, body), { kind: 'unavailable' }, JSON.stringify(body))
  }
  assert.deepEqual(readOrderAnswer(503, null), { kind: 'unavailable' })
})

test('payment paths', () => {
  assert.deepEqual([CHECKOUT_PATH, PAYMENT_TERMS_PATH, RECEIPTS_PATH], ['/access/checkout', '/payment-terms', '/access/receipts'])
  assert.equal(checkoutHref('plus_session'), '/access/checkout?plan=plus_session')
})

test('a saved selection returns only to Confirm courses or a practice result on our own site', () => {
  for (const path of ['/access/checkout?plan=plus_session', `/courses/bua-216/quiz?attempt=${ORDER}`, '/access/checkout']) {
    assert.equal(selectionReturnPath(path), path)
  }
  for (const path of ['https://evil.example', '//evil.example', '/access', '/courses/bua-216', '/courses/BUA/quiz',
    '/access/checkout?plan=<script>', '/access/checkout#x', '/access/checkout/../../login', `/access/checkout?${'a'.repeat(200)}`,
    null, 42]) {
    assert.equal(selectionReturnPath(path), null, String(path))
  }
  assert.equal(profileSelectionHref('/access/checkout?plan=plus_session'),
    '/profile-selection?return=%2Faccess%2Fcheckout%3Fplan%3Dplus_session')
  assert.equal(profileSelectionHref('https://evil.example'), '/profile-selection')
  assert.equal(profileSelectionHref(), '/profile-selection')
})
