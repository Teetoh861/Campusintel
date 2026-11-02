// lib/payments/fake.ts — Deterministic stand-in for Bachs, for tests and local runs only (config.ts refuses it outside a
// verified local environment). It signs and verifies deliveries exactly like Bachs, with a fixed test secret, and
// answers from fixed rules: a checkout is open until a test sets its outcome. Creating a checkout twice for one order
// returns the same session, as Bachs' Idempotency-Key does.
import 'server-only'
import { parseEventEnvelope, ProviderRejectedError, ProviderUnavailableError } from './provider'
import type { CheckoutRequest, CheckoutSnapshot, CreatedCheckout, PaymentProvider, RefundRequest, RefundSnapshot,
  WebhookCheck } from './provider'
import { SIGNATURE_HEADER, signatureHeader, verifySignature } from './signature'

export const FAKE_WEBHOOK_SECRET = 'fake-provider-test-secret-never-used-for-money'
export const FAKE_CHECKOUT_ORIGIN = 'https://checkout.fake.invalid'

export type FakePayment = NonNullable<CheckoutSnapshot['payment']>
export type FakeProvider = PaymentProvider & {
  /** Set what the provider will report for a checkout from now on. */
  setCheckout(checkoutId: string, answer: Pick<CheckoutSnapshot, 'status'> & { payment?: FakePayment | null;
    reference?: string | null }): void
  setRefundOutcome(outcome: RefundSnapshot['status'] | 'unavailable'): void
  failNextRead(times?: number): void
  /** A signed delivery for the webhook route, as Bachs would send it. */
  signedDelivery(event: Record<string, unknown>, timestamp?: number): { body: string; headers: Headers }
  readonly calls: { create: number; read: number; refund: number }
  /** The amount asked for by each refund, by idempotency key (undefined: the whole payment). */
  readonly refundAmounts: Map<string, number | undefined>
}

export function fakeCheckoutId(orderId: string): string {
  return `fchk_${orderId}`
}

export function createFakeProvider(options: { now?: () => number } = {}): FakeProvider {
  const now = options.now ?? Date.now
  const sessions = new Map<string, CheckoutSnapshot>()
  const refunds = new Map<string, RefundSnapshot>()
  const calls = { create: 0, read: 0, refund: 0 }
  const refundAmounts = new Map<string, number | undefined>()
  let refundOutcome: RefundSnapshot['status'] | 'unavailable' = 'pending'
  let failingReads = 0

  return {
    id: 'fake',
    calls,
    refundAmounts,
    async createCheckout(input: CheckoutRequest): Promise<CreatedCheckout> {
      calls.create += 1
      const checkoutId = fakeCheckoutId(input.orderId)
      if (!sessions.has(checkoutId)) sessions.set(checkoutId, { checkoutId, status: 'open', reference: input.orderId, payment: null })
      return { checkoutId, checkoutUrl: `${FAKE_CHECKOUT_ORIGIN}/c/${input.orderId}`,
        expiresAt: new Date(now() + input.expiresInMinutes * 60_000).toISOString() }
    },
    verifyWebhook(rawBody: string, headers: Headers): WebhookCheck {
      const check = verifySignature(headers.get(SIGNATURE_HEADER), rawBody, [FAKE_WEBHOOK_SECRET], Math.floor(now() / 1000))
      if (!check.ok) return check
      const event = parseEventEnvelope(rawBody)
      return event === null ? { ok: false, reason: 'malformed' } : { ok: true, event }
    },
    async getCheckout(checkoutId: string): Promise<CheckoutSnapshot> {
      calls.read += 1
      if (failingReads > 0) { failingReads -= 1; throw new ProviderUnavailableError('fake read failed') }
      const session = sessions.get(checkoutId)
      if (session === undefined) throw new ProviderRejectedError('fake checkout not found', 'NOT_FOUND', 404)
      return structuredClone(session)
    },
    async refund(input: RefundRequest): Promise<RefundSnapshot> {
      calls.refund += 1
      if (refundOutcome === 'unavailable') throw new ProviderUnavailableError('fake refund unavailable')
      const existing = refunds.get(input.idempotencyKey)
      if (existing) return { ...existing }
      const refund = { refundId: `fref_${input.idempotencyKey}`, reference: input.reference, status: refundOutcome }
      refunds.set(input.idempotencyKey, refund)
      refundAmounts.set(input.idempotencyKey, input.amountKobo)
      return { ...refund }
    },
    async getRefund(refundId: string): Promise<RefundSnapshot> {
      const found = [...refunds.values()].find(refund => refund.refundId === refundId)
      if (!found) throw new ProviderRejectedError('fake refund not found', 'NOT_FOUND', 404)
      return { ...found }
    },
    setCheckout(checkoutId, answer) {
      const current = sessions.get(checkoutId)
      sessions.set(checkoutId, { checkoutId, status: answer.status,
        reference: answer.reference !== undefined ? answer.reference : current?.reference ?? null,
        payment: answer.payment !== undefined ? answer.payment : current?.payment ?? null })
    },
    setRefundOutcome(outcome) { refundOutcome = outcome },
    failNextRead(times = 1) { failingReads = times },
    signedDelivery(event, timestamp = Math.floor(now() / 1000)) {
      const body = JSON.stringify(event)
      return { body, headers: new Headers({ 'content-type': 'application/json',
        [SIGNATURE_HEADER]: signatureHeader([FAKE_WEBHOOK_SECRET], timestamp, body) }) }
    },
  }
}
