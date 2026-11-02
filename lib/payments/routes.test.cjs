// lib/payments/routes.test.cjs — The payment routes' HTTP contract on the fake provider, with the database stubbed:
// origin and form checks, 303 targets, webhook 400/413/503 and duplicate handling, cron auth, and the owner-only order
// read. The database rules themselves run against a real stack in payments-server.database.test.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { handleCheckout, handleOrderRead, handleReconcile, handleWebhook } = require('./routes.ts')
const { createFakeProvider, fakeCheckoutId } = require('./fake.ts')

const ORIGIN = 'https://campusintell.test'
const ORDER = '7c2e9b63-4d5e-4f60-9b7c-8d9e0f1a2b3c'
const REQUEST = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const CRON = 'c'.repeat(40)
const order = (extra = {}) => ({ id: ORDER, status: 'created', amount_kobo: 400000, currency: 'NGN', provider: 'fake',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), checkout_id: null, checkout_url: null,
  checkout_expires_at: null, return_path: '/access', ...extra })

function deps({ answers = {}, student = { userId: 'u1', sessionId: 's1', readOwnOrder: async () => ({ state: 'confirming' }) },
  provider = createFakeProvider() } = {}) {
  const calls = []
  const rpc = async (fn, args) => {
    calls.push([fn, args])
    const answer = answers[fn]
    if (answer instanceof Error) throw answer
    return typeof answer === 'function' ? answer(args, calls) : answer
  }
  return { calls, provider, deps: { rpc, checkoutProvider: provider, providerFor: id => id === 'fake' ? provider : null,
    origin: ORIGIN, resolveStudent: async () => student, cronSecret: CRON } }
}

const form = (fields, headers = {}) => new Request(`${ORIGIN}/api/payments/checkout`, { method: 'POST',
  headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ plan: 'standard_semester', expected_profile_revision: '3', request_id: REQUEST,
    return_path: '/access', continuity: 'token', ...fields }).toString() })
const status = order => ({ policy: { checkout_minutes: 60 }, orders: order ? [{ created_at: new Date().toISOString(),
  payments: [], refunds: [], ...order }] : [] })

test('checkout: cross-site and malformed requests are refused before any database call', async () => {
  const { calls, deps: d } = deps()
  assert.equal((await handleCheckout(form({}, { origin: 'https://evil.example' }), d)).status, 403)
  assert.equal((await handleCheckout(form({}, { 'sec-fetch-site': 'cross-site' }), d)).status, 403)
  for (const fields of [{ plan: 'gold' }, { request_id: 'nope' }, { expected_profile_revision: '-1' },
    { return_path: '//evil.example' }, { return_path: 'https://evil.example' }, { return_path: '/a\\b' }, { continuity: '' }]) {
    const response = await handleCheckout(form(fields), d)
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), `${ORIGIN}/access/checkout?status=invalid-request`, JSON.stringify(fields))
  }
  // An amount in the form is not a field we read: the price can only come from the order.
  const json = new Request(`${ORIGIN}/api/payments/checkout`, { method: 'POST', headers: { origin: ORIGIN,
    'content-type': 'application/json' }, body: JSON.stringify({ plan: 'standard_semester', amount: 1 }) })
  assert.equal((await handleCheckout(json, d)).headers.get('location'), `${ORIGIN}/access/checkout?status=invalid-request`)
  assert.equal(calls.length, 0)
})

test('checkout: signed out goes back to the confirm screen; a created order goes to the hosted page with 303', async () => {
  const signedOut = deps({ student: 'signed-out' })
  assert.equal((await handleCheckout(form({}), signedOut.deps)).headers.get('location'),
    `${ORIGIN}/access/checkout?plan=standard_semester&status=signed-out`)
  const { calls, provider, deps: d } = deps({ answers: {
    create_payment_order: { state: 'created', order: order() },
    admin_payment_status: status(order()),
    attach_payment_checkout: args => ({ state: 'pending', order: order({ status: 'pending', checkout_id: args.p_checkout_id,
      checkout_url: args.p_checkout_url, checkout_expires_at: args.p_checkout_expires_at }) }),
  } })
  const response = await handleCheckout(form({ amount: '1' }), d)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), `https://checkout.fake.invalid/c/${ORDER}`)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(calls[0], ['create_payment_order', { p_session_id: 's1', p_plan: 'standard_semester',
    p_expected_profile_revision: 3, p_request_id: REQUEST, p_return_path: '/access', p_provider: 'fake' }])
  assert.equal(provider.calls.create, 1)
})

test('checkout: refusals and provider outages land on the confirm screen with the reason', async () => {
  for (const state of ['sales-closed', 'already-paid', 'needs-selection', 'selection-changed', 'signed-out']) {
    const { deps: d } = deps({ answers: { create_payment_order: { state } } })
    assert.equal((await handleCheckout(form({}), d)).headers.get('location'),
      `${ORIGIN}/access/checkout?plan=standard_semester&status=${state}`)
  }
  const provider = createFakeProvider()
  provider.createCheckout = async () => { throw new (require('./provider.ts').ProviderUnavailableError)('down') }
  const { deps: d } = deps({ provider, answers: { create_payment_order: { state: 'created', order: order() },
    admin_payment_status: status(order()) } })
  assert.equal((await handleCheckout(form({}), d)).headers.get('location'),
    `${ORIGIN}/access/checkout?plan=standard_semester&status=unavailable`)
  const broken = deps({ answers: { create_payment_order: new Error('database down') } })
  assert.equal((await handleCheckout(form({}), broken.deps)).headers.get('location'),
    `${ORIGIN}/access/checkout?plan=standard_semester&status=unavailable`)
})

test('webhook: bad signature 400, stale 400, oversized 413, nothing stored', async () => {
  const { calls, provider, deps: d } = deps()
  const event = { id: 'evt_1', type: 'checkout.completed', data: { checkout_id: fakeCheckoutId(ORDER), reference: ORDER } }
  const signed = provider.signedDelivery(event)
  const real = signed.headers.get('x-bachs-signature-v2')
  // Always a different first digit: a fixed replacement is a no-op when the real digest already starts with it.
  const forgedHeader = real.replace(/v1=(.)/, (_match, first) => `v1=${first === '0' ? '1' : '0'}`)
  assert.notEqual(forgedHeader, real)
  const forged = new Request(`${ORIGIN}/api/payments/webhooks/bachs`, { method: 'POST', body: signed.body,
    headers: { 'x-bachs-signature-v2': forgedHeader } })
  assert.equal((await handleWebhook(forged, d)).status, 400)
  const stale = provider.signedDelivery(event, Math.floor(Date.now() / 1000) - 301)
  assert.equal((await handleWebhook(new Request(`${ORIGIN}/w`, { method: 'POST', body: stale.body, headers: stale.headers }), d)).status, 400)
  const big = JSON.stringify({ ...event, padding: 'x'.repeat(1024 * 1024) })
  const huge = provider.signedDelivery(JSON.parse(big))
  assert.equal((await handleWebhook(new Request(`${ORIGIN}/w`, { method: 'POST', body: huge.body, headers: huge.headers }), d)).status, 413)
  assert.equal(calls.length, 0)
})

test('webhook: stored once, re-verified with the provider, 2xx; our own failure is 5xx so Bachs retries', async () => {
  const pending = order({ status: 'pending', checkout_id: fakeCheckoutId(ORDER) })
  const { calls, provider, deps: d } = deps({ answers: {
    record_payment_event: (_args, log) => ({ state: log.filter(([fn]) => fn === 'record_payment_event').length > 1 ? 'duplicate' : 'recorded' }),
    admin_payment_status: status(pending),
  } })
  const event = { id: 'evt_1', type: 'collection.succeeded', data: { checkout_id: fakeCheckoutId(ORDER), reference: ORDER,
    amount: '4000.00', status: 'SUCCEEDED', customer: { email: 'ada@example.test' } } }
  provider.setCheckout(fakeCheckoutId(ORDER), { status: 'open', reference: ORDER })
  const delivery = () => { const signed = provider.signedDelivery(event)
    return new Request(`${ORIGIN}/w`, { method: 'POST', body: signed.body, headers: signed.headers }) }
  // The body says SUCCEEDED, but Bachs (the fake) still reports the checkout open: nothing is fulfilled.
  const first = await handleWebhook(delivery(), d)
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { received: true, duplicate: false, result: 'waiting' })
  assert.equal(calls.some(([fn]) => fn === 'fulfil_payment'), false)
  const stored = calls.find(([fn]) => fn === 'record_payment_event')[1]
  assert.match(stored.p_body_hash, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(calls), /ada@example/)
  // A redelivery is stored as a duplicate and verified again (fulfilment returns its first answer).
  assert.deepEqual(await (await handleWebhook(delivery(), d)).json(), { received: true, duplicate: true, result: 'waiting' })
  provider.failNextRead()
  assert.equal((await handleWebhook(delivery(), d)).status, 503)
  const down = deps({ answers: { record_payment_event: new Error('db down') } })
  const signed = down.provider.signedDelivery(event)
  assert.equal((await handleWebhook(new Request(`${ORIGIN}/w`, { method: 'POST', body: signed.body, headers: signed.headers }),
    down.deps)).status, 503)
})

test('reconcile: the cron bearer only', async () => {
  const { calls, deps: d } = deps({ answers: { payment_orders_to_check: [] } })
  for (const header of [undefined, 'Bearer wrong', `Basic ${CRON}`, `Bearer ${CRON}x`]) {
    const response = await handleReconcile(new Request(`${ORIGIN}/api/payments/reconcile`,
      { headers: header ? { authorization: header } : {} }), d)
    assert.equal(response.status, 401, String(header))
  }
  assert.equal(calls.length, 0)
  const ok = await handleReconcile(new Request(`${ORIGIN}/api/payments/reconcile`, { headers: { authorization: `Bearer ${CRON}` } }), d)
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).checked, 0)
  const short = deps({ answers: { payment_orders_to_check: [] } })
  short.deps.cronSecret = 'short'
  assert.equal((await handleReconcile(new Request(`${ORIGIN}/r`, { headers: { authorization: 'Bearer short' } }), short.deps)).status, 401)
})

test('order read: signed out 401, unknown or foreign 404, our state only, no-store, verify at most every 10 s', async () => {
  assert.equal((await handleOrderRead(new Request(`${ORIGIN}/o`), ORDER, deps({ student: 'signed-out' }).deps)).status, 401)
  const foreign = deps({ student: { userId: 'u2', sessionId: 's2', readOwnOrder: async () => ({ state: 'not-found' }) } })
  assert.equal((await handleOrderRead(new Request(`${ORIGIN}/o`), ORDER, foreign.deps)).status, 404)
  assert.equal((await handleOrderRead(new Request(`${ORIGIN}/o`), 'not-a-uuid', foreign.deps)).status, 404)
  const id = '8d3f0c74-5e6f-4071-8c8d-9e0f1a2b3c4d'
  const { calls, deps: d } = deps({ answers: { admin_payment_status: status(order({ id, status: 'pending',
    checkout_id: fakeCheckoutId(id) })) },
  student: { userId: 'u1', sessionId: 's1', readOwnOrder: async () => ({ state: 'confirming', order_id: id }) } })
  d.providerFor = () => { const fake = createFakeProvider(); fake.setCheckout(fakeCheckoutId(id), { status: 'open', reference: id }); return fake }
  const response = await handleOrderRead(new Request(`${ORIGIN}/o?status=success`), id, d)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { state: 'confirming', order_id: id })
  await handleOrderRead(new Request(`${ORIGIN}/o`), id, d)
  assert.equal(calls.filter(([fn]) => fn === 'admin_payment_status').length, 1, 'one provider check per 10 seconds')
})

// A stand-in for payment_orders_to_check and record_payment_check: due orders in the database's order, each check
// moving the order's next check later. Every order here is already paid, so a check asks the provider nothing.
function dueOrders(count) {
  const due = Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  const recorded = new Map()
  const answers = {
    payment_orders_to_check: ({ p_limit }) => due.filter(id => !recorded.has(id)).slice(0, p_limit)
      .map(id => ({ order_id: id, action: 'check' })),
    record_payment_check: ({ p_order_id, p_result }) => { recorded.set(p_order_id, p_result); return { state: 'recorded' } },
    admin_payment_status: ({ p_order_id }) => status(order({ id: p_order_id, status: 'paid' })),
  }
  return { due, recorded, answers }
}

test('reconcile: more candidates than one query (500) and one batch (50) are all checked, once each, and recorded', async () => {
  const { due, recorded, answers } = dueOrders(612)
  const { calls, deps: d } = deps({ answers })
  const ok = await handleReconcile(new Request(`${ORIGIN}/api/payments/reconcile`, { headers: { authorization: `Bearer ${CRON}` } }), d)
  const summary = await ok.json()
  assert.equal(summary.checked, 612)
  assert.equal(summary.batches, 13)
  assert.equal(recorded.size, 612)
  assert.ok(due.every(id => recorded.get(id) === 'settled'))
  const queries = calls.filter(([fn]) => fn === 'payment_orders_to_check')
  assert.ok(queries.every(([, args]) => args.p_limit === 50 && args.p_include_late === true))
})

test('reconcile: a run that runs out of time leaves the rest due, and the next run continues where it stopped', async () => {
  const { due, recorded, answers } = dueOrders(120)
  const { deps: d } = deps({ answers })
  let clock = 0
  d.now = () => { clock += 1000; return clock }
  // About 50 seconds of budget at one second per clock read: the first run stops part way.
  const run = async () => (await handleReconcile(new Request(`${ORIGIN}/r`, { headers: { authorization: `Bearer ${CRON}` } }), d)).json()
  const first = await run()
  assert.ok(first.checked > 0 && first.checked < 120, JSON.stringify(first))
  assert.equal(recorded.size, first.checked)
  let runs = 1
  while (recorded.size < due.length && runs < 10) { await run(); runs += 1 }
  assert.equal(recorded.size, 120, 'every candidate is checked within a bounded number of runs')
})

test('reconcile: unsuccessful checks are recorded too, so they move on instead of blocking the queue', async () => {
  const { recorded, answers } = dueOrders(3)
  answers.admin_payment_status = ({ p_order_id }) => {
    if (p_order_id.endsWith('1')) throw new Error('database down')
    return status(order({ id: p_order_id, status: 'pending', checkout_id: fakeCheckoutId(p_order_id) }))
  }
  const { deps: d } = deps({ answers })
  d.providerFor = () => null
  const summary = await (await handleReconcile(new Request(`${ORIGIN}/r`, { headers: { authorization: `Bearer ${CRON}` } }), d)).json()
  assert.equal(summary.checked, 3)
  assert.equal(summary.failed, 3)
  assert.deepEqual([...recorded.values()].sort(), ['error', 'provider-unavailable', 'provider-unavailable'])
})
