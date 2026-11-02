// scripts/entitlements/payments.cjs — Payment commands for ops.cjs. Same conventions: --actor and --reason on every
// change, audited by the database function it calls; nothing prints an email, card or bank detail. Commands that ask
// the payment provider (payment-verify, payment-fulfil, refund --confirm, refund-retry, reconcile-now) reuse the
// server's code in lib/payments, so they run with the TypeScript loader:
//   node -r ./lib/auth/test-loader.cjs scripts/entitlements/ops.cjs <command> ...
// and read BACHS_API_KEY from the environment (a live key only with NODE_ENV=production). See docs/payments-operations.md.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFUND_CLASSES = /^(standard|our-fault|duplicate)$/
const AUTH_TIMEOUT_MS = 30_000

function paymentsLib() {
  if (!require.extensions['.ts']) {
    throw new Error('this command asks the payment provider: run it as node -r ./lib/auth/test-loader.cjs ' +
      'scripts/entitlements/ops.cjs ...')
  }
  return { config: require('../../lib/payments/config.ts'), verify: require('../../lib/payments/verify.ts'),
    refunds: require('../../lib/payments/refunds.ts') }
}

function isoTime(value, name) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO time`)
  return new Date(value).toISOString()
}

/** The order's student id, read with the service role (admin_payment_status), or null once the account is gone. */
async function orderOwner(rpc, orderId) {
  const status = await rpc('admin_payment_status', { p_user_id: null, p_order_id: orderId })
  const order = status && Array.isArray(status.orders) ? status.orders[0] : undefined
  if (!order) throw new Error('order not found')
  return typeof order.user_id === 'string' ? order.user_id : null
}

/** Refund identity: keyed hashes of the student's confirmed email (never printed), or the order alone when the account
 *  is gone, which cannot take a standard refund. */
async function refundIdentity(ctx, orderId, refundClass) {
  const { refunds } = paymentsLib()
  const userId = await orderOwner(ctx.rpc, orderId)
  if (userId === null) {
    if (refundClass === 'standard') throw new Error('the account is deleted: a standard refund cannot be checked; use our-fault or duplicate')
    return refunds.orphanOrderIdentity(orderId)
  }
  const response = await ctx.authAdmin(`/auth/v1/admin/users/${userId}`)
  const email = response && typeof response.email === 'string' ? response.email : null
  if (email === null) throw new Error('the student\'s email could not be read')
  const hashes = refunds.refundIdentityHashes(email, ctx.env)
  if (hashes === null) throw new Error('ENTITLEMENT_CLAIM_HASH_KEYS is missing or invalid')
  return hashes
}

function providers(ctx) {
  return paymentsLib().config.readPaymentsConfig(ctx.env).providerFor
}

async function refund(opts, ctx) {
  const { required, note } = ctx.helpers
  const orderId = required(opts, 'order', UUID)
  const refundClass = required(opts, 'class', REFUND_CLASSES)
  const requestedAt = opts['requested-at'] ? isoTime(opts['requested-at'], '--requested-at') : undefined
  // A second payment on one order (extra-payment) is refunded by naming that payment's id from payment-status.
  const payment = opts.payment !== undefined ? { p_payment_id: required(opts, 'payment', UUID) } : {}
  const identity = await refundIdentity(ctx, orderId, refundClass)
  if (opts.confirm !== true) {
    // Dry run: what the database would decide, with every count. Nothing is written and no money moves.
    return { dryRun: true, eligibility: await ctx.rpc('refund_eligibility', { p_order_id: orderId,
      p_identity_hashes: identity, ...(requestedAt ? { p_requested_at: requestedAt } : {}), ...payment }) }
  }
  const { refunds } = paymentsLib()
  const recorded = await ctx.rpc('refund_order', { p_order_id: orderId, p_class: refundClass,
    p_request_id: required(opts, 'request', UUID), p_identity_hashes: identity, ...note(),
    ...(requestedAt ? { p_requested_at: requestedAt } : {}), ...payment })
  const pending = refunds.pendingRefund.safeParse(recorded)
  if (!pending.success) return { refund: recorded }
  return { refund: recorded, settlement: await refunds.settleRefund({ rpc: ctx.rpc, providerFor: providers(ctx) },
    pending.data, { manualReference: opts['manual-reference'] ?? null, actor: note().p_actor, reason: note().p_reason }) }
}

async function refundRetry(opts, ctx) {
  const { required, note } = ctx.helpers
  const orderId = required(opts, 'order', UUID)
  const { refunds } = paymentsLib()
  const plan = await refunds.planRefundRetry(ctx.rpc, orderId)
  const deps = { rpc: ctx.rpc, providerFor: providers(ctx) }
  const settle = pending => refunds.settleRefund(deps, pending, { manualReference: opts['manual-reference'] ?? null,
    actor: note().p_actor, reason: note().p_reason })
  if (plan.state === 'resend') return { retried: 'resend', settlement: await settle(plan.refund) }
  if (plan.state !== 'renew') return plan
  const identity = await refundIdentity(ctx, orderId, plan.failed.refundClass)
  // Same class and the time the student first asked; a stable request id, so repeating this replays it.
  const recorded = await ctx.rpc('refund_order', { p_order_id: orderId, p_class: plan.failed.refundClass,
    p_request_id: plan.failed.requestId, p_identity_hashes: identity, ...note(), p_requested_at: plan.failed.requestedAt })
  const pending = refunds.pendingRefund.safeParse(recorded)
  return pending.success ? { retried: 'renew', refund: recorded, settlement: await settle(pending.data) } : { refund: recorded }
}

/** The payment command for ops.cjs, or null when the command is not a payment command. */
function paymentCommand(command, opts, ctx) {
  const { required, integer, note } = ctx.helpers
  switch (command) {
    case 'payment-status': {
      const order = opts.order !== undefined ? required(opts, 'order', UUID) : null
      const user = order === null ? required(opts, 'user', UUID) : null
      return async () => ctx.rpc('admin_payment_status', { p_user_id: user, p_order_id: order })
    }
    case 'payments-health': return async () => ctx.rpc('admin_payments_health', {})
    case 'open-sales': return async () => ctx.rpc('admin_set_sales_open', { p_open: true, ...note() })
    case 'close-sales': return async () => ctx.rpc('admin_set_sales_open', { p_open: false, ...note() })
    case 'campus-bot-model': return async () => ctx.rpc('admin_set_campus_bot_model', {
      p_model: required(opts, 'model', /^[a-z][a-z0-9-]{0,39}$/), p_price_weight: integer(opts, 'weight'), ...note() })
    case 'campus-bot-cap': return async () => ctx.rpc('admin_set_campus_bot_request_cap', {
      p_step: required(opts, 'step', /^(writing|check)$/),
      p_read_tokens_max: opts.read !== undefined ? integer(opts, 'read') : null,
      p_written_tokens_max: opts.written !== undefined ? integer(opts, 'written') : null, ...note() })
    case 'payment-verify':
    case 'payment-fulfil': {
      if (opts['manual-evidence'] !== undefined) {
        throw new Error('manual-evidence fulfilment is not available: a grant needs a payment verified with the provider. ' +
          'Use payment-verify, or payment-fulfil --provider-ref <checkout id> once the provider shows the payment')
      }
      const orderId = required(opts, 'order', UUID)
      const checkoutId = command === 'payment-fulfil' ? required(opts, 'provider-ref', /^[A-Za-z0-9_.:-]{1,128}$/) : null
      const { p_actor: actor } = note()
      return async () => paymentsLib().verify.verifyOrder({ rpc: ctx.rpc, providerFor: providers(ctx) }, orderId,
        'operator', `operator:${actor}`.slice(0, 120), { checkoutId })
    }
    case 'refund': return () => refund(opts, ctx)
    case 'refund-retry': return () => refundRetry(opts, ctx)
    case 'reconcile-now': return async () => paymentsLib().verify.reconcileOrders(
      { rpc: ctx.rpc, providerFor: providers(ctx) }, { includeLate: true })
    default: return null
  }
}

/** A read of Supabase Auth's admin API with the same secret key, used only to read one student's email. */
function authAdminReader(env, transport) {
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '')
  const key = env.SUPABASE_SECRET_KEY || ''
  return async path => {
    const response = await transport(new URL(path, url), { method: 'GET', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS), headers: { apikey: key,
        ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}) } })
    if (!response.ok) throw new Error(`student account read refused (${response.status})`)
    return response.json()
  }
}

module.exports = { paymentCommand, authAdminReader }
