// lib/payments/verify.ts — The one fulfil path. Webhook, return page, reconcile and operator all ask the provider about
// the order's checkout now and hand a verified success to fulfil_payment, whose unique keys make every replay, retry or
// race produce one fulfilment and return the first answer. Nothing is granted from a redirect or a webhook body.
import 'server-only'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { PAYMENT_CHECK_TIMEOUT_MS, RECONCILE_RUN_TIMEOUT_MS,
  RECONCILE_START_BUDGET_MS, withPaymentTimeout } from './timeouts'
import { decideCheckout } from './provider'
import type { PaymentProvider } from './provider'
import { call, readOrder } from './rpc'
import type { PaymentRpc } from './rpc'

export type FulfilSource = 'webhook' | 'return' | 'reconcile' | 'operator'
export type VerifyDeps = { rpc: PaymentRpc; providerFor(id: string): PaymentProvider | null; signal?: AbortSignal }

// Orders whose payment is already decided: asking the provider again could not change them.
const SETTLED = new Set(['paid', 'amount-mismatch', 'paid-duplicate', 'unfulfilled', 'refund-pending', 'refunded',
  'refund-failed'])
const OPEN = new Set(['created', 'pending'])

const fulfilResult = z.object({ state: z.string(), outcome: z.string().optional(), order_status: z.string().optional() })
  .passthrough()
const outcomeResult = z.object({ state: z.string(), order_status: z.string().optional() }).passthrough()

export type VerifyResult =
  | { state: 'not-found' | 'provider-unavailable' | 'no-checkout' }
  | { state: 'settled'; orderStatus: string }
  | { state: 'fulfilment'; outcome: string | null; orderStatus: string | null; result: Record<string, unknown> }
  | { state: 'ended'; outcome: string; orderStatus: string | null }
  | { state: 'waiting'; providerStatus: string; orderStatus: string }
  | { state: 'review'; reason: string; orderStatus: string }

/**
 * Ask the provider about one order and act on the answer. checkoutHint is a checkout id from a verified delivery,
 * used only when we never stored one (the attach step was lost); the provider's answer must still name this order as
 * its reference. Provider and database failures propagate, so the caller can answer "try again".
 */
export async function verifyOrder(deps: VerifyDeps, orderId: string, source: FulfilSource, actor: string,
  options: { checkoutHint?: string | null; checkoutId?: string | null; force?: boolean } = {}): Promise<VerifyResult> {
  const { order } = await readOrder(deps.rpc, orderId)
  if (order === null) return { state: 'not-found' }
  if (SETTLED.has(order.status) && !options.force) return { state: 'settled', orderStatus: order.status }
  const provider = deps.providerFor(order.provider)
  if (provider === null) return { state: 'provider-unavailable' }
  // An operator may name the checkout outright (payment-fulfil --provider-ref); its reference must still be this order.
  const checkoutId = options.checkoutId ?? order.checkout_id ?? options.checkoutHint ?? null
  if (checkoutId === null) return { state: 'no-checkout' }
  const decision = decideCheckout(await withPaymentTimeout(signal => provider.getCheckout(checkoutId, { signal }),
    PAYMENT_CHECK_TIMEOUT_MS, deps.signal), order.id)
  if (decision.action === 'fulfil') {
    const result = await call(deps.rpc, 'fulfil_payment', { p_order_id: order.id, p_provider: provider.id,
      p_provider_payment_id: decision.paymentId, p_provider_status: decision.status, p_amount_kobo: decision.amountKobo,
      p_currency: decision.currency, p_method: decision.method, p_provider_paid_at: decision.paidAt, p_source: source,
      p_actor: actor }, fulfilResult)
    return { state: 'fulfilment', outcome: result.outcome ?? null, orderStatus: result.order_status ?? null, result }
  }
  if (decision.action === 'outcome' && OPEN.has(order.status)) {
    const result = await call(deps.rpc, 'record_payment_outcome', { p_order_id: order.id, p_outcome: decision.outcome,
      p_provider_status: decision.providerStatus, p_source: source }, outcomeResult)
    return { state: 'ended', outcome: decision.outcome, orderStatus: result.order_status ?? null }
  }
  if (decision.action === 'review') {
    console.error('payments: order needs review', decision.reason)
    return { state: 'review', reason: decision.reason, orderStatus: order.status }
  }
  return { state: 'waiting', providerStatus: decision.action === 'wait' ? decision.providerStatus : decision.outcome,
    orderStatus: order.status }
}

const checkRow = z.object({ order_id: z.string().uuid(), action: z.enum(['check', 'expire', 'late-check']) })
const checkRecorded = z.object({ state: z.string() }).passthrough()
export const RECONCILE_BATCH = 50
export type ReconcileSummary = { checked: number; fulfilled: number; ended: number; expired: number; waiting: number;
  failed: number; skipped: number; batches: number }
type CheckResult = 'waiting' | 'fulfilled' | 'ended' | 'expired' | 'settled' | 'review' | 'no-checkout' | 'not-found'
  | 'provider-unavailable' | 'error'

/** One bounded run. Atomically leased orders stay due until their result is recorded by the lease's owner.
 * No check starts after 40 seconds; every RPC and provider read is bounded, with a 55-second outer deadline. */
export async function reconcileOrders(deps: VerifyDeps, options: { includeLate: boolean; limit?: number;
  deadline?: number; now?: () => number }): Promise<ReconcileSummary> {
  const now = options.now ?? Date.now
  const startDeadline = Math.min(options.deadline ?? Infinity, now() + RECONCILE_START_BUDGET_MS)
  const batchSize = Math.min(Math.max(options.limit ?? RECONCILE_BATCH, 1), RECONCILE_BATCH)
  const leaseToken = randomUUID()
  const summary: ReconcileSummary = { checked: 0, fulfilled: 0, ended: 0, expired: 0, waiting: 0, failed: 0, skipped: 0,
    batches: 0 }
  return withPaymentTimeout(async runSignal => {
    const bounded: VerifyDeps = { ...deps, signal: runSignal, rpc: (fn, args, request) => {
      const signal = request?.signal ? AbortSignal.any([request.signal, runSignal]) : runSignal
      signal.throwIfAborted()
      return deps.rpc(fn, args, { signal })
    } }
    while (now() < startDeadline) {
      runSignal.throwIfAborted()
      const rows = await call(bounded.rpc, 'claim_payment_checks', { p_limit: batchSize,
        p_include_late: options.includeLate, p_lease_token: leaseToken }, z.array(checkRow))
      if (rows.length === 0) break
      summary.batches += 1
      for (const row of rows) {
        runSignal.throwIfAborted()
        if (now() >= startDeadline) { summary.skipped += 1; continue }
        summary.checked += 1
        const result = await checkOne(bounded, row, summary)
        // A timed-out/uncertain check is unfinished. Keep its due time and let the lease expire; no back-off.
        if (result === null) continue
        try {
          runSignal.throwIfAborted()
          const completed = await call(bounded.rpc, 'record_payment_check', { p_order_id: row.order_id, p_result: result,
            p_lease_token: leaseToken }, checkRecorded)
          if (completed.state !== 'recorded') summary.failed += 1
        } catch (error) {
          summary.failed += 1
          console.error('payments: reconcile check not recorded', error instanceof Error ? error.name : 'unknown')
        }
      }
    }
    return summary
  }, RECONCILE_RUN_TIMEOUT_MS)
}

async function checkOne(deps: VerifyDeps, row: z.infer<typeof checkRow>, summary: ReconcileSummary): Promise<CheckResult | null> {
  try {
    const result = await verifyOrder(deps, row.order_id, 'reconcile', 'system:reconcile')
    if (result.state === 'fulfilment') { summary.fulfilled += 1; return 'fulfilled' }
    if (result.state === 'ended') { summary.ended += 1; return 'ended' }
    if (row.action === 'expire' && result.state !== 'settled' && result.state !== 'provider-unavailable') {
      const expired = await call(deps.rpc, 'record_payment_outcome', { p_order_id: row.order_id, p_outcome: 'expired',
        p_provider_status: null, p_source: 'reconcile' }, outcomeResult)
      if (expired.state === 'recorded') { summary.expired += 1; return 'expired' }
    }
    if (result.state === 'provider-unavailable') { summary.failed += 1; return null }
    summary.waiting += 1
    return result.state
  } catch (error) {
    summary.failed += 1
    console.error('payments: reconcile check failed', error instanceof Error ? error.name : 'unknown')
    return null
  }
}

const RETURN_VERIFY_INTERVAL_MS = 10_000
const lastReturnVerify = new Map<string, number>()

/** At most one provider verify per order per 10 seconds from return-page polling (per server instance). */
export function takeReturnVerifySlot(orderId: string, now: number = Date.now()): boolean {
  const last = lastReturnVerify.get(orderId)
  if (last !== undefined && now - last < RETURN_VERIFY_INTERVAL_MS) return false
  lastReturnVerify.set(orderId, now)
  if (lastReturnVerify.size > 10_000) {
    for (const [id, at] of lastReturnVerify) if (now - at >= RETURN_VERIFY_INTERVAL_MS) lastReturnVerify.delete(id)
  }
  return true
}
