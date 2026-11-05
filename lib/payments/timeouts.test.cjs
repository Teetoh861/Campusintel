const { test } = require('node:test')
const assert = require('node:assert/strict')
const { withPaymentTimeout, PaymentTimeoutError, PAYMENT_DATABASE_TIMEOUT_MS, PAYMENT_CHECK_TIMEOUT_MS,
  RECONCILE_START_BUDGET_MS, RECONCILE_RUN_TIMEOUT_MS } = require('./timeouts.ts')
const { call } = require('./rpc.ts')
const { reconcileOrders } = require('./verify.ts')
const { z } = require('zod')
const ID = '12345678-1234-4234-8234-123456789012'
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }

test('a database call that ignores cancellation is still bounded, with its signal aborted', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const result = call(async (_fn, _args, options) => {
    signal = options.signal
    return new Promise(() => {})
  }, 'admin_payment_status', {}, z.unknown())
  const refused = assert.rejects(result, PaymentTimeoutError)
  await flush()
  t.mock.timers.tick(PAYMENT_DATABASE_TIMEOUT_MS)
  await refused
  assert.equal(signal.aborted, true)
})

test('the timeout bounds reading the response body too, and honours parent cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const parent = new AbortController()
  let signal
  const response = withPaymentTimeout(async current => {
    signal = current
    return new Promise(() => {})
  }, 4000, parent.signal)
  const refused = assert.rejects(response, /cancelled by run/)
  await flush()
  parent.abort(new Error('cancelled by run'))
  await refused
  assert.equal(signal.aborted, true)
})

test('no check starts at or after 40 seconds, and claimed but unstarted work is not completed', async () => {
  let clock = 0
  const starts = []
  const recorded = []
  const summary = await reconcileOrders({ providerFor: () => null, rpc: async (fn, args) => {
    if (fn === 'claim_payment_checks') return [1, 2].map(n => ({ order_id: ID.slice(0, -1) + n, action: 'check' }))
    if (fn === 'admin_payment_status') {
      starts.push(clock)
      clock = RECONCILE_START_BUDGET_MS
      return { policy: { checkout_minutes: 60 }, orders: [] }
    }
    if (fn === 'record_payment_check') { recorded.push(args.p_order_id); return { state: 'recorded' } }
    throw new Error(fn)
  } }, { includeLate: true, now: () => clock })
  assert.deepEqual(starts, [0])
  assert.equal(recorded.length, 1)
  assert.equal(summary.skipped, 1)
  assert.ok(RECONCILE_START_BUDGET_MS + 3 * PAYMENT_DATABASE_TIMEOUT_MS + PAYMENT_CHECK_TIMEOUT_MS
    < RECONCILE_RUN_TIMEOUT_MS)
  assert.ok(RECONCILE_RUN_TIMEOUT_MS < 60_000)
})

test('a timed-out check is recorded as provider-unavailable (a failure that backs off), not as a completed check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let claimed = false
  let recorded = null
  let signal
  const run = reconcileOrders({ providerFor: () => null, rpc: async (fn, _args, options) => {
    if (fn === 'claim_payment_checks') {
      if (claimed) return []
      claimed = true
      return [{ order_id: ID, action: 'late-check' }]
    }
    if (fn === 'admin_payment_status') { signal = options.signal; return new Promise(() => {}) }
    if (fn === 'record_payment_check') { recorded = _args.p_result; return { state: 'failed' } }
    throw new Error(fn)
  } }, { includeLate: true })
  await flush()
  t.mock.timers.tick(PAYMENT_DATABASE_TIMEOUT_MS)
  const summary = await run
  assert.equal(summary.failed, 1)
  assert.equal(recorded, 'provider-unavailable')
  assert.equal(signal.aborted, true)
})


test('a hanging Bachs verification read is bounded and cannot reach fulfilment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { verifyOrder } = require('./verify.ts')
  let signal
  let fulfilled = false
  const result = verifyOrder({ rpc: async fn => {
    if (fn === 'fulfil_payment') fulfilled = true
    return { policy: { checkout_minutes: 60 }, orders: [{ id: ID, provider: 'bachs', status: 'pending',
      amount_kobo: 400000, currency: 'NGN', checkout_id: 'checkout_1', checkout_expires_at: null,
      expires_at: new Date().toISOString(), created_at: new Date().toISOString(), payments: [], refunds: [] }] }
  }, providerFor: () => ({ id: 'bachs', getCheckout: async (_id, options) => {
    signal = options.signal
    return new Promise(() => {})
  } }) }, ID, 'reconcile', 'system:reconcile')
  const refused = assert.rejects(result, PaymentTimeoutError)
  await flush()
  t.mock.timers.tick(PAYMENT_CHECK_TIMEOUT_MS)
  await refused
  assert.equal(signal.aborted, true)
  assert.equal(fulfilled, false)
})
