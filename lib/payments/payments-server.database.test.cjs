// lib/payments/payments-server.database.test.cjs — The payment server code against a LOCAL database through PostgREST
// (the production call path), on the fake provider: design §7 rows 1–13, 21–25 and 30–33, server side, including the
// concurrent ones. No network beyond the local stack. Opt in, one file at a time, on an isolated stack:
//   PAYMENTS_SERVER_DB_TEST=1 PAYMENTS_DB_CONTAINER=supabase_db_<project> SUPABASE_WORKDIR=<stack dir> \
//     node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/payments/payments-server.database.test.cjs
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const enabled = process.env.PAYMENTS_SERVER_DB_TEST === '1'
const container = process.env.PAYMENTS_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_') && container !== 'supabase_db_Campusintel',
  'set PAYMENTS_DB_CONTAINER to the isolated test stack')
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const ORIGIN = 'https://campusintell.test'
const users = []
let rpc
let lib

function sql(statement) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v',
    'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function student({ profile = true } = {}) {
  const user = randomUUID()
  const session = randomUUID()
  users.push(user)
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','${user}','authenticated',
    'authenticated','pay-server-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    ${profile ? `update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';` : ''}`)
  return { user, session, revision: Number(sql(`select revision from public.profiles where id='${user}'`)) }
}

const fakeProvider = () => lib.fake.createFakeProvider()
const deps = provider => ({ rpc, provider, origin: ORIGIN, providerFor: id => id === 'fake' ? provider : null })
const checkout = (provider, p, plan = 'standard_semester', extra = {}) => lib.checkout.startCheckout(deps(provider), p.session,
  { plan, expectedRevision: p.revision, requestId: randomUUID(), returnPath: '/access', ...extra })
const paid = (provider, orderId, kobo = 400000, status = 'succeeded', method = 'card') =>
  provider.setCheckout(lib.fake.fakeCheckoutId(orderId), { status: 'completed', reference: orderId, payment: {
    id: `ch_${orderId.replaceAll('-', '')}`, status, amountKobo: kobo, currency: 'NGN', method, paidAt: new Date().toISOString() } })
const webhook = (provider, orderId, type = 'collection.succeeded', id = `evt_${randomUUID()}`) => {
  const signed = provider.signedDelivery({ id, type, data: { checkout_id: lib.fake.fakeCheckoutId(orderId), reference: orderId,
    customer: { email: 'ada@example.test' } } })
  return lib.webhook.handleDelivery({ rpc, provider, providerFor: () => provider },
    new Request(`${ORIGIN}/api/payments/webhooks/bachs`, { method: 'POST', body: signed.body, headers: signed.headers }))
}
const verify = (provider, orderId, source = 'return', options) =>
  lib.verify.verifyOrder({ rpc, providerFor: () => provider }, orderId, source, `system:${source}`, options)
const orderRow = id => JSON.parse(sql(`select to_jsonb(o) from private.payment_orders o where id='${id}'`))
const count = (table, where) => Number(sql(`select count(*) from ${table} where ${where}`))
const grants = id => count('public.entitlement_grants', `order_id='${id}' and revoked_at is null`)
const identity = () => [randomBytes(32).toString('hex')]

before(() => {
  if (!enabled) return
  lib = { checkout: require('./checkout.ts'), fake: require('./fake.ts'), verify: require('./verify.ts'),
    webhook: require('./webhook.ts'), refunds: require('./refunds.ts') }
  const status = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(status.status, 0, 'supabase status (set SUPABASE_WORKDIR to the isolated stack)')
  const config = JSON.parse(status.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  const { createClient } = require('@supabase/supabase-js')
  const client = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new Error(`${fn} refused (${error.code}): ${error.message}`)
    return data
  }
  sql(`update private.payment_policy set sales_open = true`)
})
after(() => {
  if (!enabled) return
  sql(`update private.payment_policy set sales_open = false`)
  const ids = users.map(id => `'${id}'`).join(',')
  // Orders outlive their student; remove this file's payment rows (append-only logs need replica mode) first.
  // Plan-use rows go before the users: part 1's append-only trigger refuses the foreign key's set-null (reported).
  if (users.length) assert.equal(sql(`create temporary table server_orders as select id from private.payment_orders where user_id in (${ids});
    set session_replication_role = replica;
    delete from private.plan_use_events where order_id in (select id from server_orders);
    set session_replication_role = origin;
    delete from auth.users where id in (${ids});
    set session_replication_role = replica;
    delete from private.payment_events where order_id in (select id from server_orders);
    delete from private.payment_refunds where order_id in (select id from server_orders);
    delete from private.payment_fulfilments where order_id in (select id from server_orders);
    delete from private.payment_orders where id in (select id from server_orders);
    set session_replication_role = origin;
    select count(*) from private.payment_orders where id in (select id from server_orders);`), '0')
})

test('rows 1, 7: webhook first, replayed five times at once: one fulfilment, one grant set, one stored delivery', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const started = await checkout(provider, p)
  assert.equal(started.state, 'redirect')
  assert.equal(started.url, `https://checkout.fake.invalid/c/${started.orderId}`)
  paid(provider, started.orderId)
  const event = `evt_${randomUUID()}`
  const answers = await Promise.all(Array.from({ length: 5 }, () => webhook(provider, started.orderId, 'collection.succeeded', event)))
  assert.deepEqual(answers.map(answer => answer.status), [200, 200, 200, 200, 200])
  assert.equal(answers.filter(answer => answer.body.duplicate === false).length, 1)
  assert.equal(orderRow(started.orderId).status, 'paid')
  assert.equal(grants(started.orderId), 1)
  assert.equal(count('private.payment_fulfilments', `order_id='${started.orderId}'`), 1)
  assert.equal(count('private.payment_events', `order_id='${started.orderId}' and event='provider.delivery'`), 1)
  // The return page then reads a settled order without asking the provider again.
  const reads = provider.calls.read
  assert.equal((await verify(provider, started.orderId)).state, 'settled')
  assert.equal(provider.calls.read, reads)
})

test('row 2: the return page fulfils first; the late webhook changes nothing; a Session plan writes two grants', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const started = await checkout(provider, p, 'standard_session')
  paid(provider, started.orderId, 700000)
  const result = await verify(provider, started.orderId)
  assert.equal(result.state, 'fulfilment')
  assert.equal(result.outcome, 'fulfilled')
  assert.equal(grants(started.orderId), 2)
  assert.equal((await webhook(provider, started.orderId, 'checkout.completed')).body.result, 'settled')
  assert.equal(count('private.payment_fulfilments', `order_id='${started.orderId}'`), 1)
})

test('rows 3, 4, 11: a decline keeps the order open; a double tap gets one order and one link; a cancel ends it', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const request = randomUUID()
  const taps = await Promise.all([0, 1, 2].map(() => checkout(provider, p, 'standard_semester', { requestId: request })))
  assert.equal(new Set(taps.map(tap => tap.orderId)).size, 1)
  assert.equal(new Set(taps.map(tap => tap.url)).size, 1)
  const orderId = taps[0].orderId
  provider.setCheckout(lib.fake.fakeCheckoutId(orderId), { status: 'open', payment: { id: 'ch_declined', status: 'failed',
    amountKobo: 400000, currency: 'NGN', method: 'card', paidAt: null } })
  assert.equal((await webhook(provider, orderId, 'collection.failed')).body.result, 'waiting')
  assert.equal(orderRow(orderId).status, 'pending')
  // Another try while the link is valid reuses the same order and link (the student can pay on the same page).
  assert.equal((await checkout(provider, p)).url, taps[0].url)
  provider.setCheckout(lib.fake.fakeCheckoutId(orderId), { status: 'cancelled', payment: null })
  assert.equal((await verify(provider, orderId)).state, 'ended')
  assert.equal(orderRow(orderId).status, 'cancelled')
  assert.equal(grants(orderId), 0)
})

test('rows 5, 6: reconcile fulfils a late success, expires a silent order, and the late check still fulfils it', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const late = student()
  const lateOrder = (await checkout(provider, late)).orderId
  const silent = student()
  const silentOrder = (await checkout(provider, silent)).orderId
  sql(`update private.payment_orders set created_at = now() - interval '10 minutes' where id = '${lateOrder}';
    update private.payment_orders set created_at = now() - interval '49 hours', expires_at = now() - interval '48 hours',
      checkout_expires_at = now() - interval '48 hours' where id = '${silentOrder}'`)
  paid(provider, lateOrder, 400000, 'succeeded', 'bank_transfer')
  const deps = { rpc, providerFor: () => provider }
  const first = await lib.verify.reconcileOrders(deps, { includeLate: false })
  assert.ok(first.fulfilled >= 1 && first.expired >= 1, JSON.stringify(first))
  assert.equal(orderRow(lateOrder).status, 'paid')
  assert.equal(orderRow(silentOrder).status, 'expired')
  paid(provider, silentOrder)
  assert.equal(orderRow(silentOrder).status, 'expired', 'nothing without the late check')
  await lib.verify.reconcileOrders(deps, { includeLate: true })
  assert.equal(orderRow(silentOrder).status, 'paid')
  assert.equal(grants(silentOrder), 1)
})

test('rows 8, 9: refused deliveries write nothing; an amount below the order is a mismatch with no grant', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const orderId = (await checkout(provider, p)).orderId
  const before = count('private.payment_events', `order_id='${orderId}'`)
  const forged = provider.signedDelivery({ id: 'evt_forged', type: 'collection.succeeded', data: { reference: orderId } })
  const answer = await lib.webhook.handleDelivery({ rpc, provider, providerFor: () => provider }, new Request(`${ORIGIN}/w`,
    { method: 'POST', body: forged.body.replace('collection', 'collectionX'), headers: forged.headers }))
  assert.equal(answer.status, 400)
  assert.equal(count('private.payment_events', `order_id='${orderId}'`), before)
  paid(provider, orderId, 4000)
  assert.equal((await webhook(provider, orderId)).status, 200)
  assert.equal(orderRow(orderId).status, 'amount-mismatch')
  assert.equal(grants(orderId), 0)
})

test('rows 10, 12: two orders for one semester paid at once: one grants, one is a duplicate; then no new checkout', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const a = (await checkout(provider, p, 'standard_semester', { returnPath: '/access' })).orderId
  const b = (await checkout(provider, p, 'standard_semester', { returnPath: '/courses' })).orderId
  assert.notEqual(a, b)
  paid(provider, a)
  paid(provider, b)
  await Promise.all([webhook(provider, a), webhook(provider, b)])
  assert.deepEqual([orderRow(a).status, orderRow(b).status].sort(), ['paid', 'paid-duplicate'])
  assert.equal(grants(a) + grants(b), 1)
  assert.deepEqual(await checkout(provider, p), { state: 'refused', reason: 'already-paid' })
})

test('row 13: unconfirmed or changed selection is refused before checkout; a change after checkout still grants, flagged', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  assert.deepEqual(await checkout(provider, p, 'standard_semester', { expectedRevision: p.revision - 1 }),
    { state: 'refused', reason: 'selection-changed' })
  const orderId = (await checkout(provider, p)).orderId
  sql(`update public.profiles set first_name = 'Adaeze' where id = '${p.user}'`)
  paid(provider, orderId)
  await webhook(provider, orderId)
  assert.equal(orderRow(orderId).status, 'paid')
  assert.equal(grants(orderId), 1)
  assert.deepEqual(await checkout(provider, student({ profile: false })), { state: 'refused', reason: 'needs-selection' })
})

test('rows 21, 25: a standard refund revokes access first, then the provider refunds once; a replay changes nothing', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const orderId = (await checkout(provider, p)).orderId
  paid(provider, orderId)
  await webhook(provider, orderId)
  const request = randomUUID()
  const ids = identity()
  const refundCall = () => rpc('refund_order', { p_order_id: orderId, p_class: 'standard', p_request_id: request,
    p_identity_hashes: ids, p_actor: 'Ops', p_reason: 'student asked within the window' })
  const recorded = lib.refunds.pendingRefund.parse(await refundCall())
  assert.equal(grants(orderId), 0, 'access ends before any money moves')
  const deps = { rpc, providerFor: () => provider }
  assert.equal((await lib.refunds.settleRefund(deps, recorded, { actor: 'Ops', reason: 'standard' })).state, 'pending')
  const replay = lib.refunds.pendingRefund.parse(await refundCall())
  assert.equal(replay.refund_id, recorded.refund_id)
  await lib.refunds.settleRefund(deps, replay, { actor: 'Ops', reason: 'standard' })
  assert.equal(provider.calls.refund, 2)
  assert.equal(count('private.payment_refunds', `order_id='${orderId}'`), 1)
  // Bachs reports the refund paid; the webhook confirms it with Bachs before recording it.
  const signed = provider.signedDelivery({ id: `evt_${randomUUID()}`, type: 'refund.paid', data: {
    refund_id: `fref_${recorded.idempotency_key}`, reference: recorded.refund_id } })
  provider.setRefundOutcome('refunded')
  const fakeRefund = provider.getRefund
  provider.getRefund = async id => ({ ...(await fakeRefund(id)), status: 'refunded' })
  assert.equal((await lib.webhook.handleDelivery({ rpc, provider, providerFor: () => provider }, new Request(`${ORIGIN}/w`,
    { method: 'POST', body: signed.body, headers: signed.headers }))).status, 200)
  assert.equal(orderRow(orderId).status, 'refunded')
})

test('rows 22, 23, 24: use, the window and the one-per-identity limit refuse a standard refund; our-fault is allowed', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const used = student()
  const usedOrder = (await checkout(provider, used)).orderId
  paid(provider, usedOrder)
  await webhook(provider, usedOrder)
  sql(`select private.mark_plan_use('${used.user}', 'campus-bot-reply', null, 'reply-1')`)
  const eligibility = await rpc('refund_eligibility', { p_order_id: usedOrder, p_identity_hashes: identity() })
  assert.equal(eligibility.standard_allowed, false)
  assert.ok(eligibility.standard_refused.includes('campus-bot'))
  const old = student()
  const oldOrder = (await checkout(provider, old)).orderId
  paid(provider, oldOrder)
  await webhook(provider, oldOrder)
  sql(`update private.payment_fulfilments set created_at = now() - interval '49 hours' where order_id = '${oldOrder}';
    update private.payment_orders set paid_at = now() - interval '49 hours' where id = '${oldOrder}'`)
  const late = await rpc('refund_eligibility', { p_order_id: oldOrder, p_identity_hashes: identity() })
  assert.equal(late.standard_allowed, false)
  assert.ok(late.classes_allowed.includes('our-fault'))
  const ids = identity()
  const first = student()
  const second = student()
  for (const [index, p] of [first, second].entries()) {
    const orderId = (await checkout(provider, p)).orderId
    paid(provider, orderId)
    await webhook(provider, orderId)
    const answer = await rpc('refund_order', { p_order_id: orderId, p_class: 'standard', p_request_id: randomUUID(),
      p_identity_hashes: ids, p_actor: 'Ops', p_reason: 'same person, second account' })
    assert.equal(answer.state, index === 0 ? 'refund-pending' : 'refused')
  }
})

test('row 25: a refund the provider refuses is recorded failed, and refund-retry renews it once', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const orderId = (await checkout(provider, p)).orderId
  paid(provider, orderId)
  await webhook(provider, orderId)
  const deps = { rpc, providerFor: () => provider }
  const recorded = lib.refunds.pendingRefund.parse(await rpc('refund_order', { p_order_id: orderId, p_class: 'our-fault',
    p_request_id: randomUUID(), p_identity_hashes: identity(), p_actor: 'Ops', p_reason: 'wrong course list' }))
  const refuse = provider.refund
  provider.refund = async () => { throw new (require('./provider.ts').ProviderRejectedError)('refused', 'NOT_REFUNDABLE', 400) }
  assert.equal((await lib.refunds.settleRefund(deps, recorded, { actor: 'Ops', reason: 'x' })).state, 'failed')
  assert.equal(orderRow(orderId).status, 'refund-failed')
  provider.refund = refuse
  provider.setRefundOutcome('refunded')
  const plan = await lib.refunds.planRefundRetry(rpc, orderId)
  assert.equal(plan.state, 'renew')
  const renew = () => rpc('refund_order', { p_order_id: orderId, p_class: plan.failed.refundClass,
    p_request_id: plan.failed.requestId, p_identity_hashes: identity(), p_actor: 'Ops', p_reason: plan.failed.reason,
    p_requested_at: plan.failed.requestedAt })
  const renewed = lib.refunds.pendingRefund.parse(await renew())
  assert.equal((await lib.refunds.settleRefund(deps, renewed, { actor: 'Ops', reason: 'retry' })).state, 'refunded')
  assert.equal(lib.refunds.pendingRefund.parse(await renew()).refund_id, renewed.refund_id, 'retrying again replays')
  assert.equal(orderRow(orderId).status, 'refunded')
})

test('rows 30, 32, 33: operator fulfilment by checkout id then the webhook: one grant set; deletion; the sales switch', { skip: !enabled }, async () => {
  const provider = fakeProvider()
  const p = student()
  const orderId = (await checkout(provider, p)).orderId
  // The attach step was lost: only the operator knows the checkout id. Still verified with the provider.
  sql(`update private.payment_orders set status = 'created', checkout_id = null, checkout_url = null,
    checkout_expires_at = null where id = '${orderId}'`)
  paid(provider, orderId)
  assert.equal((await verify(provider, orderId, 'operator', { checkoutId: lib.fake.fakeCheckoutId(orderId) })).outcome, 'fulfilled')
  await webhook(provider, orderId)
  assert.equal(grants(orderId), 1)
  assert.equal(count('private.payment_fulfilments', `order_id='${orderId}'`), 1)

  const leaving = student()
  const pending = (await checkout(provider, leaving)).orderId
  sql(`insert into private.account_deletion_jobs(user_id, requested_at, deadline, retry_at)
    values ('${leaving.user}', now(), now() + interval '720 hours', now() + interval '720 hours')`)
  // A scheduled deletion ends the live session itself, so no new checkout starts.
  assert.deepEqual(await checkout(provider, leaving, 'standard_semester', { returnPath: '/courses' }),
    { state: 'refused', reason: 'signed-out' })
  paid(provider, pending)
  await webhook(provider, pending)
  assert.equal(orderRow(pending).status, 'paid', 'money taken: still fulfilled')
  assert.ok(orderRow(pending).flags.includes('account-deletion'))

  const shopper = student()
  // Through PostgREST, part 1's admin_set_sales_open is refused by pg_safeupdate (UPDATE without WHERE; reported), so
  // the switch is flipped directly here.
  sql(`update private.payment_policy set sales_open = false where true`)
  assert.deepEqual(await checkout(provider, shopper), { state: 'refused', reason: 'sales-closed' })
  sql(`update private.payment_policy set sales_open = true where true`)
  assert.equal((await checkout(provider, shopper)).state, 'redirect')
})
