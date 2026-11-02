// lib/payments/bachs.test.cjs — The Bachs adapter against a recorded fetch: request shape, answer checks, status
// mapping, refunds and error classes. No network: every call goes to the stub, and the stub refuses unknown paths.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { bachsApiBase, createBachsProvider } = require('./bachs.ts')
const { decideCheckout, ProviderRejectedError, ProviderUnavailableError } = require('./provider.ts')
const { signatureHeader } = require('./signature.ts')

const ORDER = '6b1f8a52-3c4d-4e5f-8a6b-7c8d9e0f1a2b'
const KEY = 'sk_sandbox_test_key_for_unit_tests'
const SECRET = 'whsec_unit_test_secret_value_0001'

function stub(routes) {
  const calls = []
  const fetch = async (url, init) => {
    const key = `${init.method} ${url.pathname}`
    calls.push({ url: url.toString(), init, body: init.body ? JSON.parse(init.body) : null })
    const route = routes[key]
    if (!route) throw new Error(`unexpected ${key}`)
    const [status, json] = typeof route === 'function' ? route(calls.length) : route
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, provider: createBachsProvider({ apiKey: KEY, webhookSecrets: [SECRET], fetch, now: () => 1_793_000_000_000 }) }
}

const session = (charge, status = 'completed') => ({ checkout_id: 'chk_1', status, reference: ORDER, amount: '4000.00',
  currency: 'NGN', payment_method: charge?.payment_method ?? null, charge,
  customer: { email: 'ada@example.test', name: 'Ada' }, customer_details: { email: 'ada@example.test', name: 'Ada' } })

test('a key picks its own environment, and nothing else is accepted', () => {
  assert.equal(bachsApiBase('sk_live_abcdefgh123'), 'https://api.bachs.io')
  assert.equal(bachsApiBase('sk_sandbox_abcdefgh123'), 'https://sandbox-api.bachs.io')
  for (const bad of ['', 'pk_live_abcdefgh123', 'sk_live_', 'sk_test_abcdefgh123', ' sk_live_abcdefgh123']) {
    assert.equal(bachsApiBase(bad), null, bad)
  }
})

test('checkout: the order sets the price, methods, reference, expiry and our return page; one key per order', async () => {
  const { calls, provider } = stub({ 'POST /v1/checkout-sessions': [201, { checkout_id: 'chk_1',
    checkout_url: 'https://checkout.bachs.io/c/abc', status: 'open', expires_at: '2026-11-02T13:00:00Z', reference: ORDER }] })
  const created = await provider.createCheckout({ orderId: ORDER, amountKobo: 400000, currency: 'NGN', expiresInMinutes: 60,
    returnUrl: `https://campusintell.com/access/checkout/return?order=${ORDER}` })
  assert.deepEqual(created, { checkoutId: 'chk_1', checkoutUrl: 'https://checkout.bachs.io/c/abc',
    expiresAt: '2026-11-02T13:00:00Z' })
  const [call] = calls
  assert.equal(call.url, 'https://sandbox-api.bachs.io/v1/checkout-sessions')
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`)
  assert.equal(call.init.headers['Idempotency-Key'], `checkout-${ORDER}`)
  assert.equal(call.init.redirect, 'error')
  assert.deepEqual(call.body, { pricing: { currency: 'NGN', amount: '4000.00', price_type: 'fixed' },
    payment_method_types: ['NGN_CARD', 'NGN_BANK_TRANSFER'], reference: ORDER, metadata: { order_id: ORDER },
    expires_in_minutes: 60, success_url: `https://campusintell.com/access/checkout/return?order=${ORDER}`,
    cancel_url: `https://campusintell.com/access/checkout/return?order=${ORDER}` })
  // No customer details are sent: the hosted page collects what the receipt needs.
  assert.equal('customer' in call.body, false)
})

test('checkout: an answer for another origin, reference or without an id is refused', async () => {
  for (const answer of [{ checkout_url: 'https://evil.example/c/abc' }, { reference: 'other' }, { checkout_id: null },
    { expires_at: 'soon' }]) {
    const { provider } = stub({ 'POST /v1/checkout-sessions': [201, { checkout_id: 'chk_1',
      checkout_url: 'https://checkout.bachs.io/c/abc', expires_at: '2026-11-02T13:00:00Z', reference: ORDER, ...answer }] })
    await assert.rejects(provider.createCheckout({ orderId: ORDER, amountKobo: 400000, currency: 'NGN', expiresInMinutes: 60,
      returnUrl: 'https://campusintell.com/x' }), ProviderRejectedError)
  }
})

test('errors: timeouts, 5xx, 429 and in-progress keys are retryable; other 4xx are refusals; bodies never leak', async () => {
  for (const [status, code, kind] of [[500, null, ProviderUnavailableError], [503, null, ProviderUnavailableError],
    [429, 'RATE_LIMITED', ProviderUnavailableError], [409, 'IDEMPOTENCY_IN_PROGRESS', ProviderUnavailableError],
    [400, 'CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD', ProviderRejectedError], [401, 'UNAUTHORIZED', ProviderRejectedError]]) {
    const { provider } = stub({ 'GET /v1/checkout-sessions/chk_1': [status, { error_code: code,
      detail: 'customer ada@example.test card 4111111111111111' }] })
    const error = await provider.getCheckout('chk_1').then(() => null, caught => caught)
    assert.ok(error instanceof kind, `${status}`)
    assert.doesNotMatch(error.message, /ada@|4111|sk_sandbox/)
  }
  const offline = createBachsProvider({ apiKey: KEY, webhookSecrets: [SECRET], fetch: async () => { throw new TypeError('down') } })
  await assert.rejects(offline.getCheckout('chk_1'), ProviderUnavailableError)
})

test('verify: a paid checkout maps to fulfil with exact kobo, what arrived, and no personal data', async () => {
  const { provider } = stub({ 'GET /v1/checkout-sessions/chk_1': [200, session({ payment_id: 'ch_1', status: 'succeeded',
    amount: '4000.00', amount_paid: '4000.00', currency: 'NGN', payment_method: 'CARD', completed_at: '2026-11-02T12:05:00Z',
    payment_method_details: { type: 'card', last4: '4242' } })] })
  const snapshot = await provider.getCheckout('chk_1')
  assert.deepEqual(snapshot, { checkoutId: 'chk_1', status: 'completed', reference: ORDER, payment: { id: 'ch_1',
    status: 'succeeded', amountKobo: 400000, currency: 'NGN', method: 'card', paidAt: '2026-11-02T12:05:00Z' } })
  assert.doesNotMatch(JSON.stringify(snapshot), /ada@|4242/)
  assert.deepEqual(decideCheckout(snapshot, ORDER), { action: 'fulfil', paymentId: 'ch_1', status: 'succeeded',
    amountKobo: 400000, currency: 'NGN', method: 'card', paidAt: '2026-11-02T12:05:00Z' })
})

test('status mapping: fulfil only succeeded, accepted or overpaid on a completed checkout for this order', () => {
  const snap = (status, payment, extra = {}) => ({ checkoutId: 'chk_1', status, reference: ORDER,
    payment: payment && { id: 'ch_1', amountKobo: 400000, currency: 'NGN', method: 'bank_transfer', paidAt: null, ...payment },
    ...extra })
  for (const paid of ['succeeded', 'accepted', 'overpaid']) {
    assert.equal(decideCheckout(snap('completed', { status: paid }), ORDER).action, 'fulfil', paid)
  }
  for (const unpaid of ['created', 'processing', 'failed', 'underpaid', 'refunded', 'partially_refunded', 'auto_refunded']) {
    assert.equal(decideCheckout(snap('completed', { status: unpaid }), ORDER).action, 'wait', unpaid)
  }
  // A failed attempt leaves the checkout open for another try; an expired one can still be paid late.
  assert.deepEqual(decideCheckout(snap('open', { status: 'failed' }), ORDER), { action: 'wait', providerStatus: 'failed' })
  assert.deepEqual(decideCheckout(snap('expired', null), ORDER), { action: 'outcome', outcome: 'expired', providerStatus: 'expired' })
  assert.deepEqual(decideCheckout(snap('cancelled', null), ORDER),
    { action: 'outcome', outcome: 'cancelled', providerStatus: 'cancelled' })
  assert.deepEqual(decideCheckout(snap('completed', { status: 'succeeded' }, { reference: 'another-order' }), ORDER),
    { action: 'review', reason: 'reference-mismatch' })
  assert.deepEqual(decideCheckout(snap('completed', { status: 'succeeded', method: 'other' }), ORDER),
    { action: 'review', reason: 'unsupported-method' })
  assert.deepEqual(decideCheckout(snap('completed', { status: 'succeeded', amountKobo: null }), ORDER),
    { action: 'review', reason: 'unreadable-amount' })
})

test('verify: methods and received amounts map from Bachs fields', async () => {
  const cases = [
    [{ status: 'overpaid', amount: '4000.00', amount_paid: '4500.00', payment_method: 'NGN_BANK_TRANSFER' }, 450000, 'bank_transfer'],
    [{ status: 'accepted', amount: '4000.00', amount_paid: '3999.50', payment_method: 'BANK_TRANSFER' }, 399950, 'bank_transfer'],
    [{ status: 'succeeded', amount: '4000.00', payment_method: 'NGN_CARD' }, 400000, 'card'],
    [{ status: 'overpaid', amount: '4000.00', payment_method: 'CRYPTO' }, null, 'other'],
  ]
  for (const [charge, kobo, method] of cases) {
    const { provider } = stub({ 'GET /v1/checkout-sessions/chk_1': [200, session({ payment_id: 'ch_1', currency: 'NGN', ...charge })] })
    const { payment } = await provider.getCheckout('chk_1')
    assert.equal(payment.amountKobo, kobo, charge.status)
    assert.equal(payment.method, method, charge.payment_method)
  }
  const { provider } = stub({ 'GET /v1/checkout-sessions/chk_1': [200, { ...session(null), checkout_id: 'chk_other' }] })
  await assert.rejects(provider.getCheckout('chk_1'), ProviderRejectedError)
  await assert.rejects(provider.getCheckout('../v1/refunds'), ProviderRejectedError)
})

test('webhook: the V2 signature over the raw body, then only the envelope fields we use', () => {
  const { provider } = stub({})
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.completed', data: { checkout_id: 'chk_1', reference: ORDER,
    customer: { email: 'ada@example.test' } } })
  const headers = new Headers({ 'x-bachs-signature-v2': signatureHeader([SECRET], 1_793_000_000, body) })
  assert.deepEqual(provider.verifyWebhook(body, headers), { ok: true, event: { id: 'evt_1', type: 'checkout.completed',
    checkoutId: 'chk_1', reference: ORDER, refundId: null } })
  assert.deepEqual(provider.verifyWebhook(body, new Headers({ 'x-bachs-signature-v2': signatureHeader([SECRET], 1_792_999_000,
    body) })), { ok: false, reason: 'timestamp' })
  assert.deepEqual(provider.verifyWebhook(body, new Headers()), { ok: false, reason: 'malformed' })
  const notJson = 'not json'
  assert.deepEqual(provider.verifyWebhook(notJson, new Headers({ 'x-bachs-signature-v2':
    signatureHeader([SECRET], 1_793_000_000, notJson) })), { ok: false, reason: 'malformed' })
})

test('refund: one per payment, keyed by our request id; a lost answer is read back by charge', async () => {
  const request = { paymentId: 'ch_1', reference: 'b5f1c2d3-0000-4000-8000-000000000001',
    idempotencyKey: 'b5f1c2d3-0000-4000-8000-0000000000aa', reason: 'standard refund' }
  const { calls, provider } = stub({ 'POST /v1/refunds': [201, { refund_id: 'rfnd_1', reference: request.reference,
    status: 'processing' }] })
  assert.deepEqual(await provider.refund(request), { refundId: 'rfnd_1', reference: request.reference, status: 'pending' })
  assert.equal(calls[0].init.headers['Idempotency-Key'], request.idempotencyKey)
  assert.deepEqual(calls[0].body, { charge_id: 'ch_1', reference: request.reference, reason: 'standard refund',
    idempotency_key: request.idempotencyKey })
  // An overpayment's excess is a partial refund: the amount as Bachs' decimal string. Omitted, the whole payment.
  const partial = stub({ 'POST /v1/refunds': [201, { refund_id: 'rfnd_2', reference: request.reference, status: 'processing' }] })
  await partial.provider.refund({ ...request, amountKobo: 50000 })
  assert.equal(partial.calls[0].body.amount, '500.00')
  const conflict = stub({ 'POST /v1/refunds': [409, { error_code: 'CONFLICT' }],
    'GET /v1/refunds/by-charge/ch_1': [200, { refund_id: 'rfnd_1', reference: request.reference, status: 'success' }] })
  assert.deepEqual(await conflict.provider.refund(request), { refundId: 'rfnd_1', reference: request.reference, status: 'refunded' })
  const other = stub({ 'POST /v1/refunds': [409, { error_code: 'CONFLICT' }],
    'GET /v1/refunds/by-charge/ch_1': [200, { refund_id: 'rfnd_9', reference: 'someone-else', status: 'success' }] })
  await assert.rejects(other.provider.refund(request), /another refund/)
  const failed = stub({ 'GET /v1/refunds/rfnd_1': [200, { refund_id: 'rfnd_1', reference: request.reference, status: 'failed' }] })
  assert.equal((await failed.provider.getRefund('rfnd_1')).status, 'failed')
})
