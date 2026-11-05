// lib/payments/provider.ts — The provider-neutral payment interface and the one rule that turns a provider's answer
// into an action. A provider reports; only decideCheckout says whether to fulfil, and only fulfil_payment grants.
// Nothing here stores or returns personal data: no email, name, card or bank detail leaves the adapter.
import 'server-only'

export type ProviderId = 'bachs' | 'fake'
export type PaymentMethod = 'card' | 'bank_transfer'

export type CheckoutRequest = {
  orderId: string
  amountKobo: number
  currency: 'NGN'
  expiresInMinutes: number
  returnUrl: string
}
export type CreatedCheckout = { checkoutId: string; checkoutUrl: string; expiresAt: string }

/** The provider's answer about one checkout, already reduced to what fulfilment needs. */
export type CheckoutSnapshot = {
  checkoutId: string
  status: 'open' | 'completed' | 'expired' | 'cancelled'
  reference: string | null
  payment: null | {
    id: string
    status: string
    amountKobo: number | null
    currency: string | null
    method: PaymentMethod | 'other' | null
    paidAt: string | null
  }
}

export type WebhookEvent = {
  id: string
  type: string
  checkoutId: string | null
  reference: string | null
  refundId: string | null
}
export type WebhookCheck = { ok: true; event: WebhookEvent } | { ok: false; reason: 'malformed' | 'timestamp' | 'signature' }

/** amountKobo: a partial refund (an overpayment's excess); omitted, the whole payment. A payment takes one refund. */
export type RefundRequest = { paymentId: string; reference: string; idempotencyKey: string; reason: string;
  amountKobo?: number }
export type RefundSnapshot = { refundId: string; reference: string | null; status: 'pending' | 'refunded' | 'failed' }

export interface PaymentProvider {
  readonly id: ProviderId
  createCheckout(input: CheckoutRequest): Promise<CreatedCheckout>
  verifyWebhook(rawBody: string, headers: Headers): WebhookCheck
  getCheckout(checkoutId: string, options?: { signal?: AbortSignal }): Promise<CheckoutSnapshot>
  /** Absent when the provider cannot refund; refunds are then settled manually with our bank reference. */
  refund?(input: RefundRequest): Promise<RefundSnapshot>
  getRefund?(refundId: string): Promise<RefundSnapshot>
}

/** A provider call that failed in a way worth retrying (timeout, 5xx, rate limit, uncertain write). */
export class ProviderUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnavailableError' }
}
/** A provider call the provider refused for good (4xx other than 408/409/429), or an answer we cannot trust. */
export class ProviderRejectedError extends Error {
  constructor(message: string, readonly code: string | null = null, readonly status: number | null = null) {
    super(message)
    this.name = 'ProviderRejectedError'
  }
}

const PAID = new Set(['succeeded', 'accepted', 'overpaid'])

export type CheckoutDecision =
  | { action: 'fulfil'; paymentId: string; status: 'succeeded' | 'accepted' | 'overpaid'; amountKobo: number;
      currency: string; method: PaymentMethod; paidAt: string | null }
  | { action: 'outcome'; outcome: 'cancelled' | 'expired'; providerStatus: string }
  | { action: 'wait'; providerStatus: string }
  | { action: 'review'; reason: 'reference-mismatch' | 'unsupported-method' | 'unreadable-amount' }

/**
 * Fulfil only a completed checkout for this order whose payment is succeeded, accepted or overpaid, with an exact
 * amount and a card or bank-transfer method. Amount and currency are compared with the order by fulfil_payment (part
 * 1's rules), never here. A failed attempt leaves the checkout open for another try, so it is a wait, not an ending;
 * an expired checkout can still be paid late, which a later check fulfils.
 */
export function decideCheckout(snapshot: CheckoutSnapshot, orderId: string): CheckoutDecision {
  if (snapshot.reference !== orderId) return { action: 'review', reason: 'reference-mismatch' }
  const payment = snapshot.payment
  if (snapshot.status === 'completed' && payment !== null && PAID.has(payment.status)) {
    if (payment.method !== 'card' && payment.method !== 'bank_transfer') return { action: 'review', reason: 'unsupported-method' }
    if (payment.amountKobo === null || payment.amountKobo <= 0 || payment.currency === null) {
      return { action: 'review', reason: 'unreadable-amount' }
    }
    return { action: 'fulfil', paymentId: payment.id, status: payment.status as 'succeeded' | 'accepted' | 'overpaid',
      amountKobo: payment.amountKobo, currency: payment.currency, method: payment.method, paidAt: payment.paidAt }
  }
  if (snapshot.status === 'cancelled') return { action: 'outcome', outcome: 'cancelled', providerStatus: 'cancelled' }
  if (snapshot.status === 'expired') return { action: 'outcome', outcome: 'expired', providerStatus: 'expired' }
  return { action: 'wait', providerStatus: payment?.status ?? snapshot.status }
}

const EVENT_ID = /^[A-Za-z0-9_.:-]{1,200}$/
const EVENT_TYPE = /^[a-z][a-z0-9_.]{1,60}$/
const REFERENCE = /^[A-Za-z0-9_.:-]{1,128}$/

/** The envelope fields we use from a verified delivery. Everything else in the body is ignored and never stored. */
export function parseEventEnvelope(rawBody: string): WebhookEvent | null {
  let body: unknown
  try { body = JSON.parse(rawBody) } catch { return null }
  if (typeof body !== 'object' || body === null) return null
  const { id, type, data } = body as Record<string, unknown>
  if (typeof id !== 'string' || !EVENT_ID.test(id) || typeof type !== 'string' || !EVENT_TYPE.test(type)) return null
  const fields = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
  const reference = (value: unknown) => typeof value === 'string' && REFERENCE.test(value) ? value : null
  return { id, type, checkoutId: reference(fields.checkout_id), reference: reference(fields.reference),
    refundId: reference(fields.refund_id) }
}
