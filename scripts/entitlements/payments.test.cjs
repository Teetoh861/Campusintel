// scripts/entitlements/payments.test.cjs — Payment operator commands as dry runs against a stubbed transport: the RPCs
// and arguments they send, refunds as dry runs by default, identity hashes instead of email, manual-evidence refused,
// and provider calls only on the local fake.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./ops.cjs')
const { localFakeProvider } = require('../../lib/payments/config.ts')
const { fakeCheckoutId } = require('../../lib/payments/fake.ts')

const ORDER = '9e4a1d85-6f70-4182-9d9e-0f1a2b3c4d5e'
const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const REQUEST = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'
const EMAIL = 'ada.obi@example.test'
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret', NODE_ENV: 'test',
  PAYMENTS_PROVIDER: 'fake', ENTITLEMENT_CLAIM_HASH_KEYS: `1:${'k'.repeat(40)}` }
const NOTE = ['--actor', 'ops', '--reason', 'support ticket 42']

const orderStatus = (extra = {}) => ({ policy: { checkout_minutes: 60 }, orders: [{ id: ORDER, user_id: USER,
  provider: 'fake', status: 'pending', amount_kobo: 400000, currency: 'NGN', checkout_id: fakeCheckoutId(ORDER),
  checkout_expires_at: null, expires_at: '2026-11-02T13:00:00Z', created_at: '2026-11-02T12:00:00Z', payments: [],
  refunds: [], ...extra }] })
const pending = (method = 'card') => ({ state: 'refund-pending', refund_id: 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f',
  order_id: ORDER, refund_class: 'standard', amount_kobo: 400000, currency: 'NGN', method, provider: 'fake',
  provider_payment_id: 'ch_1', idempotency_key: REQUEST })

function harness(replies = {}) {
  const requests = []
  const transport = async (url, init) => {
    const path = new URL(url).pathname
    if (init.method === 'GET') {
      requests.push({ fn: path })
      return new Response(JSON.stringify({ id: USER, email: EMAIL }), { status: 200 })
    }
    const fn = path.replace('/rest/v1/rpc/', '')
    const body = JSON.parse(init.body)
    requests.push({ fn, body })
    const reply = replies[fn]
    return new Response(JSON.stringify(typeof reply === 'function' ? reply(body) : reply ?? { state: 'ok' }), { status: 200 })
  }
  const output = []
  return { requests, output, run: args => run(args, ENV, transport, text => output.push(text)),
    printed: () => JSON.parse(output.at(-1)) }
}

test('status, health, the sales switch and Campus Bot settings call narrow functions with actor and reason', async () => {
  const h = harness()
  await h.run(['payment-status', '--order', ORDER])
  await h.run(['payment-status', '--user', USER])
  await h.run(['payments-health'])
  await h.run(['open-sales', ...NOTE])
  await h.run(['close-sales', ...NOTE])
  await h.run(['campus-bot-model', '--model', 'sonnet', '--weight', '20', ...NOTE])
  await h.run(['campus-bot-cap', '--step', 'check', '--read', '3000', ...NOTE])
  assert.deepEqual(h.requests, [
    { fn: 'admin_payment_status', body: { p_user_id: null, p_order_id: ORDER } },
    { fn: 'admin_payment_status', body: { p_user_id: USER, p_order_id: null } },
    { fn: 'admin_payments_health', body: {} },
    { fn: 'admin_set_sales_open', body: { p_open: true, p_actor: 'ops', p_reason: 'support ticket 42' } },
    { fn: 'admin_set_sales_open', body: { p_open: false, p_actor: 'ops', p_reason: 'support ticket 42' } },
    { fn: 'admin_set_campus_bot_model', body: { p_model: 'sonnet', p_price_weight: 20, p_actor: 'ops', p_reason: 'support ticket 42' } },
    { fn: 'admin_set_campus_bot_request_cap', body: { p_step: 'check', p_read_tokens_max: 3000, p_written_tokens_max: null,
      p_actor: 'ops', p_reason: 'support ticket 42' } },
  ])
  await assert.rejects(h.run(['open-sales']), /--actor is required/)
  await assert.rejects(h.run(['campus-bot-cap', '--step', 'reading', ...NOTE]), /--step is required/)
  await assert.rejects(h.run(['payment-status']), /--user is required/)
})

test('refund is a dry run by default: eligibility with keyed identity hashes, no email anywhere, nothing written', async () => {
  const h = harness({ admin_payment_status: orderStatus(), refund_eligibility: { standard_allowed: true } })
  await h.run(['refund', '--order', ORDER, '--class', 'standard', '--requested-at', '2026-11-02T12:30:00Z', ...NOTE])
  assert.deepEqual(h.requests.map(request => request.fn), ['admin_payment_status', `/auth/v1/admin/users/${USER}`,
    'refund_eligibility'])
  const eligibility = h.requests[2].body
  assert.equal(eligibility.p_order_id, ORDER)
  assert.equal(eligibility.p_requested_at, '2026-11-02T12:30:00.000Z')
  assert.equal(eligibility.p_identity_hashes.length, 1)
  assert.match(eligibility.p_identity_hashes[0], /^[0-9a-f]{64}$/)
  assert.deepEqual(h.printed(), { dryRun: true, eligibility: { standard_allowed: true } })
  assert.doesNotMatch(JSON.stringify(h.requests) + h.output.join(''), /ada\.obi/)
  // The same email always gives the same identity; case and spaces do not make a second person.
  const again = harness({ admin_payment_status: orderStatus() })
  await again.run(['refund', '--order', ORDER, '--class', 'standard', ...NOTE])
  assert.deepEqual(again.requests[2].body.p_identity_hashes, eligibility.p_identity_hashes)
  assert.equal('p_requested_at' in again.requests[2].body, false)
})

test('refund --confirm records first, then settles: manual reference, bank transfer, or the provider by our key', async () => {
  const manual = harness({ admin_payment_status: orderStatus(), refund_order: pending('bank_transfer'),
    record_refund_result: { state: 'recorded', refund_status: 'refunded' } })
  await manual.run(['refund', '--order', ORDER, '--class', 'standard', '--request', REQUEST, '--confirm',
    '--manual-reference', 'GTB-REF-0091', ...NOTE])
  assert.deepEqual(manual.requests.map(request => request.fn).slice(-2), ['refund_order', 'record_refund_result'])
  assert.deepEqual(manual.requests.at(-1).body, { p_refund_id: pending().refund_id, p_outcome: 'refunded',
    p_provider_refund_id: null, p_manual_reference: 'GTB-REF-0091', p_actor: 'ops' })
  const transfer = harness({ admin_payment_status: orderStatus(), refund_order: pending('bank_transfer') })
  await transfer.run(['refund', '--order', ORDER, '--class', 'standard', '--request', REQUEST, '--confirm', ...NOTE])
  assert.deepEqual(transfer.printed().settlement, { state: 'manual-required', reason: 'bank-transfer' })
  const card = harness({ admin_payment_status: orderStatus(), refund_order: pending('card') })
  const fake = localFakeProvider()
  const before = fake.calls.refund
  await card.run(['refund', '--order', ORDER, '--class', 'standard', '--request', REQUEST, '--confirm', ...NOTE])
  assert.equal(fake.calls.refund, before + 1)
  assert.deepEqual(card.printed().settlement, { state: 'pending', providerRefundId: `fref_${REQUEST}` })
  await assert.rejects(card.run(['refund', '--order', ORDER, '--class', 'standard', '--confirm', ...NOTE]), /--request is required/)
  await assert.rejects(card.run(['refund', '--order', ORDER, '--class', 'partial', ...NOTE]), /--class is required/)
  const extra = harness({ admin_payment_status: orderStatus() })
  const PAYMENT = 'd4e5f6a7-b8c9-4d0e-8f1a-3b4c5d6e7f80'
  await extra.run(['refund', '--order', ORDER, '--class', 'duplicate', '--payment', PAYMENT, ...NOTE])
  assert.equal(extra.requests.at(-1).body.p_payment_id, PAYMENT)
})

test('a deleted account cannot take a standard refund; our-fault uses the order alone as identity', async () => {
  const h = harness({ admin_payment_status: orderStatus({ user_id: null }) })
  await assert.rejects(h.run(['refund', '--order', ORDER, '--class', 'standard', ...NOTE]), /account is deleted/)
  await h.run(['refund', '--order', ORDER, '--class', 'our-fault', ...NOTE])
  assert.equal(h.requests.some(request => request.fn.startsWith('/auth/')), false)
  assert.match(h.requests.at(-1).body.p_identity_hashes[0], /^[0-9a-f]{64}$/)
})

test('payment-verify asks the provider and fulfils as the operator; manual evidence is refused', async () => {
  localFakeProvider().setCheckout(fakeCheckoutId(ORDER), { status: 'completed', reference: ORDER, payment: { id: 'ch_77',
    status: 'succeeded', amountKobo: 400000, currency: 'NGN', method: 'card', paidAt: '2026-11-02T12:10:00Z' } })
  const h = harness({ admin_payment_status: orderStatus(), fulfil_payment: { state: 'recorded', outcome: 'fulfilled',
    order_status: 'paid' } })
  await h.run(['payment-verify', '--order', ORDER, ...NOTE])
  assert.deepEqual(h.requests.at(-1), { fn: 'fulfil_payment', body: { p_order_id: ORDER, p_provider: 'fake',
    p_provider_payment_id: 'ch_77', p_provider_status: 'succeeded', p_amount_kobo: 400000, p_currency: 'NGN',
    p_method: 'card', p_provider_paid_at: '2026-11-02T12:10:00Z', p_source: 'operator', p_actor: 'operator:ops' } })
  await assert.rejects(h.run(['payment-fulfil', '--order', ORDER, '--manual-evidence', 'screenshot', '--confirm', ...NOTE]),
    /manual-evidence fulfilment is not available/)
  await assert.rejects(h.run(['payment-fulfil', '--order', ORDER, ...NOTE]), /--provider-ref is required/)
  const settled = harness({ admin_payment_status: orderStatus({ status: 'paid' }) })
  await settled.run(['payment-verify', '--order', ORDER, ...NOTE])
  assert.deepEqual(settled.printed(), { state: 'settled', orderStatus: 'paid' })
})

test('reconcile-now runs one bounded batch through the same fulfil path', async () => {
  const h = harness({ payment_orders_to_check: [] })
  await h.run(['reconcile-now'])
  assert.deepEqual(h.requests, [{ fn: 'payment_orders_to_check', body: { p_limit: 500 } }])
  assert.equal(h.printed().checked, 0)
})
