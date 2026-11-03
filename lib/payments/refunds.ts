// lib/payments/refunds.ts — Refunds after part 1's refund_order has recorded the refund (and, for a plan refund, revoked
// every grant) in its own transaction, before any money moves. Here: the provider refund, keyed by our refund request id
// so a retry can never refund twice. Cards keep their one Bachs refund for a plan refund; card excess goes through
// Bachs support. Bank refunds are sent from the bank to the account that paid,
// and recorded with our transfer reference and that account's last four digits.
import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { normalizeClaimEmail, readClaimHashKeys } from '@/lib/entitlements/claim-hash'
import { ProviderRejectedError, ProviderUnavailableError } from './provider'
import type { PaymentProvider } from './provider'
import { call, readOrder } from './rpc'
import { OPERATOR_WRITE_TIMEOUT_MS } from './timeouts'
import type { PaymentRpc } from './rpc'

type Env = Readonly<Record<string, string | undefined>>
// Domain-separated from Discovery Pass claims: the same keys, a different purpose, so neither hash reveals the other.
const PURPOSE = 'campusintell:payment-refund-identity:v1'
const MAX_IDENTITY_HASHES = 4

/** Keyed hashes of the student's confirmed email, one per configured key (current first), so a deleted and
 *  re-registered account is still the same person for the one-standard-refund rule. Null without valid keys. */
export function refundIdentityHashes(email: string, env: Env = process.env): string[] | null {
  const keys = readClaimHashKeys(env)
  if (keys === null) return null
  const normalized = normalizeClaimEmail(email)
  return keys.all.slice(0, MAX_IDENTITY_HASHES)
    .map(({ key }) => createHmac('sha256', key).update(`${PURPOSE}:${normalized}`, 'utf8').digest('hex'))
}

/** For an order whose account is gone there is no email: a hash of the order itself, which matches nothing else. */
export function orphanOrderIdentity(orderId: string): string[] {
  return [createHash('sha256').update(`${PURPOSE}:order:${orderId}`, 'utf8').digest('hex')]
}

export const pendingRefund = z.object({ state: z.literal('refund-pending'), refund_id: z.string().uuid(),
  order_id: z.string().uuid(), refund_class: z.string(), amount_kobo: z.number(), currency: z.string(),
  method: z.enum(['card', 'bank_transfer']), provider: z.string(), provider_payment_id: z.string(),
  idempotency_key: z.string().uuid(), refund_status: z.string().optional(), payment_id: z.string().uuid().optional() })
  .passthrough()
export type PendingRefund = z.infer<typeof pendingRefund>
const settled = z.object({ state: z.string(), refund_status: z.string().optional() }).passthrough()

export type RefundDeps = { rpc: PaymentRpc; providerFor(id: string): PaymentProvider | null }

/** A manual settlement: our bank transfer reference, and the last four digits of the account it was sent to, which the
 *  operator has confirmed match the sender Bachs shows for this payment. */
export type ManualSettlement = { reference: string; accountLast4: string; destinationConfirmed: boolean }

/** Refuses a manual settlement the database would refuse, before anything is recorded: card payments, or a bank
 *  transfer without the paying account's last four digits and the operator's confirmation. */
export function checkManualSettlement(method: string, manual: ManualSettlement | null): void {
  if (manual === null) return
  if (method !== 'bank_transfer') {
    throw new Error('card refunds go only through Bachs: --manual-reference is for bank transfers')
  }
  if (!/^[0-9]{4}$/.test(manual.accountLast4)) throw new Error('--account-last4 must be the paying account\'s last four digits')
  if (!manual.destinationConfirmed) {
    throw new Error('--destination-confirmed is required: the transfer must go to the account Bachs shows as the sender')
  }
}
/** Card excess is handled by Bachs support, preserving the card's single provider refund for a plan refund. */
export function checkRefundMethod(refundClass: string, method: string): void {
  if (refundClass === 'excess' && method === 'card') throw new Error('Card excess refunds go through Bachs support')
}
export type RefundOutcome =
  | { state: 'refunded' | 'failed' | 'pending'; providerRefundId?: string }
  | { state: 'manual-required'; reason: 'bank-transfer' | 'no-refund-api' }
  | { state: 'provider-unavailable' | 'already-final' }

/** Move money for a recorded refund, or record a manual one. Safe to repeat: same key, same refund. */
export async function settleRefund(deps: RefundDeps, refund: PendingRefund, options: { manual?: ManualSettlement | null;
  actor: string; reason: string }): Promise<RefundOutcome> {
  if (refund.refund_status !== undefined && refund.refund_status !== 'pending') return { state: 'already-final' }
  checkRefundMethod(refund.refund_class, refund.method)
  const manual = options.manual ?? null
  checkManualSettlement(refund.method, manual)
  if (manual !== null) {
    const result = await call(deps.rpc, 'record_refund_result', { p_refund_id: refund.refund_id, p_outcome: 'refunded',
      p_provider_refund_id: null, p_manual_reference: manual.reference, p_actor: options.actor,
      p_account_last4: manual.accountLast4 }, settled, { timeoutMs: OPERATOR_WRITE_TIMEOUT_MS })
    return result.state === 'recorded' || result.state === 'unchanged' ? { state: 'refunded' } : { state: 'already-final' }
  }
  if (refund.method === 'bank_transfer') return { state: 'manual-required', reason: 'bank-transfer' }
  const provider = deps.providerFor(refund.provider)
  if (provider === null) return { state: 'provider-unavailable' }
  if (provider.refund === undefined) return { state: 'manual-required', reason: 'no-refund-api' }
  let answer
  try {
    answer = await provider.refund({ paymentId: refund.provider_payment_id, reference: refund.refund_id,
      idempotencyKey: refund.idempotency_key, reason: options.reason,
      ...(refund.refund_class === 'excess' ? { amountKobo: refund.amount_kobo } : {}) })
  } catch (error) {
    // Uncertain or refused: the refund stays pending (access is already gone) until refund-retry or a webhook.
    if (error instanceof ProviderUnavailableError) return { state: 'provider-unavailable' }
    if (error instanceof ProviderRejectedError) {
      await call(deps.rpc, 'record_refund_result', { p_refund_id: refund.refund_id, p_outcome: 'failed',
        p_provider_refund_id: null, p_manual_reference: null, p_actor: options.actor }, settled,
        { timeoutMs: OPERATOR_WRITE_TIMEOUT_MS })
      return { state: 'failed' }
    }
    throw error
  }
  if (answer.status !== 'pending') {
    await call(deps.rpc, 'record_refund_result', { p_refund_id: refund.refund_id, p_outcome: answer.status,
      p_provider_refund_id: answer.refundId, p_manual_reference: null, p_actor: options.actor }, settled,
      { timeoutMs: OPERATOR_WRITE_TIMEOUT_MS })
  }
  return { state: answer.status, providerRefundId: answer.refundId }
}

/** A stable request id for retrying one failed refund, so repeating refund-retry replays instead of refunding twice. */
export function retryRequestId(failedRefundId: string): string {
  const hex = createHash('sha256').update(`campusintell:refund-retry:${failedRefundId}`, 'utf8').digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export type RetryPlan =
  | { state: 'nothing-to-retry' | 'not-found' }
  | { state: 'resend'; refund: PendingRefund }
  | { state: 'renew'; failed: { id: string; refundClass: string; requestedAt: string; reason: string; requestId: string;
      paymentId: string; method: string } }

/** What refund-retry should do for an order: resend a pending refund (same key), or re-request a failed one for the same
 *  payment. Each payment carries a plan refund and an excess refund separately; the most recent unfinished one is retried
 *  (a later refund of the same payment and kind replaces an earlier failed one). */
export async function planRefundRetry(rpc: PaymentRpc, orderId: string): Promise<RetryPlan> {
  const { order } = await readOrder(rpc, orderId)
  if (order === null) return { state: 'not-found' }
  const newestFirst = [...order.refunds].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const seen = new Set<string>()
  const current = newestFirst.filter(refund => {
    const kind = `${refund.payment_id}:${refund.refund_class === 'excess'}`
    if (seen.has(kind)) return false
    seen.add(kind)
    return true
  })
  const latest = current.find(refund => refund.status !== 'refunded')
  if (latest === undefined) return { state: 'nothing-to-retry' }
  const payment = order.payments.find(item => item.id === latest.payment_id)
  if (payment === undefined) return { state: 'nothing-to-retry' }
  if (latest.status === 'failed') {
    return { state: 'renew', failed: { id: latest.id, refundClass: latest.refund_class, requestedAt: latest.requested_at,
      reason: latest.reason, requestId: retryRequestId(latest.id), paymentId: latest.payment_id, method: payment.method } }
  }
  return { state: 'resend', refund: pendingRefund.parse({ state: 'refund-pending', refund_id: latest.id,
    order_id: order.id, payment_id: latest.payment_id, refund_class: latest.refund_class, amount_kobo: latest.amount_kobo,
    currency: payment.currency,
    method: payment.method, provider: payment.provider, provider_payment_id: payment.provider_payment_id,
    idempotency_key: latest.request_id, refund_status: 'pending' }) }
}
