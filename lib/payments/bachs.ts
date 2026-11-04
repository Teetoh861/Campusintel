// lib/payments/bachs.ts — Bachs adapter: plain fetch and node:crypto, no SDK (docs.bachs.io, read 2 November 2026).
// Checkout: POST /v1/checkout-sessions priced from our order (never the client) as an exact NGN decimal string,
// card and bank transfer only, our order id as the reference (unique for good on Bachs' side) and in metadata, and an
// Idempotency-Key tied to the order, so a retry or a double tap gets the same session. Verify: GET the session.
// Refund: POST /v1/refunds, one per payment; bank transfers cannot be refunded through Bachs. Error messages carry
// Bachs' error_code only: response bodies can hold customer details and are never logged or stored.
import 'server-only'
import { decimalToKobo, koboToDecimal } from './money'
import { parseEventEnvelope, ProviderRejectedError, ProviderUnavailableError } from './provider'
import type { CheckoutRequest, CheckoutSnapshot, CreatedCheckout, PaymentMethod, PaymentProvider, RefundRequest,
  RefundSnapshot, WebhookCheck } from './provider'
import { SIGNATURE_HEADER, verifySignature } from './signature'

export const BACHS_CHECKOUT_ORIGIN = 'https://checkout.bachs.io'
const LIVE_API = 'https://api.bachs.io'
const SANDBOX_API = 'https://sandbox-api.bachs.io'
const OPAQUE_ID = /^[A-Za-z0-9_.:-]{1,128}$/
// The webhook must answer within Bachs' 10 seconds, so its verification read is short; writes may take longer.
const TIMEOUTS = { read: 4_000, checkout: 8_000, refund: 10_000 }

type Fetch = typeof fetch
export type BachsOptions = { apiKey: string; webhookSecrets: readonly string[]; fetch?: Fetch; now?: () => number }

/** The API base for a key: live keys reach production, sandbox keys the sandbox. Anything else is refused. */
export function bachsApiBase(apiKey: string): string | null {
  if (/^sk_live_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return LIVE_API
  if (/^sk_sandbox_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return SANDBOX_API
  return null
}

function opaque(value: unknown): string | null {
  return typeof value === 'string' && OPAQUE_ID.test(value) ? value : null
}

// Bachs reports cards as CARD and other methods by corridor; a general request can come back as BANK_TRANSFER.
function methodOf(value: unknown): PaymentMethod | 'other' | null {
  if (value === null || value === undefined) return null
  if (value === 'CARD' || value === 'NGN_CARD' || value === 'USD_CARD') return 'card'
  if (value === 'NGN_BANK_TRANSFER' || value === 'BANK_TRANSFER') return 'bank_transfer'
  return 'other'
}

function refundStatus(value: unknown): RefundSnapshot['status'] {
  if (value === 'success' || value === 'paid' || value === 'succeeded') return 'refunded'
  if (value === 'failed') return 'failed'
  return 'pending'
}

export function createBachsProvider(options: BachsOptions): PaymentProvider {
  const configuredBase = bachsApiBase(options.apiKey)
  if (configuredBase === null) throw new Error('Bachs configuration unavailable')
  const base: string = configuredBase
  const send = options.fetch ?? fetch
  const now = options.now ?? Date.now

  async function request(method: 'GET' | 'POST', path: string, timeoutMs: number,
    body?: Record<string, unknown>, idempotencyKey?: string, signal?: AbortSignal): Promise<{ status: number; json: Record<string, unknown> }> {
    let response: Response
    try {
      response = await send(new URL(path, base), {
        method, cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new ProviderUnavailableError(`Bachs ${method} unavailable`)
    }
    const json = await response.json().catch(() => null) as Record<string, unknown> | null
    const code = json && typeof json.error_code === 'string' ? json.error_code.slice(0, 80) : null
    if (response.ok && json !== null) return { status: response.status, json }
    if (response.status === 408 || response.status === 429 || response.status >= 500 || code === 'IDEMPOTENCY_IN_PROGRESS') {
      throw new ProviderUnavailableError(`Bachs ${method} ${response.status}${code ? ` ${code}` : ''}`)
    }
    if (response.ok) throw new ProviderUnavailableError(`Bachs ${method} returned an unreadable body`)
    throw new ProviderRejectedError(`Bachs ${method} refused (${response.status}${code ? ` ${code}` : ''})`, code, response.status)
  }

  function refundSnapshot(json: Record<string, unknown>): RefundSnapshot {
    const refundId = opaque(json.refund_id)
    if (refundId === null) throw new ProviderRejectedError('Bachs refund without a usable id')
    return { refundId, reference: typeof json.reference === 'string' ? json.reference : null, status: refundStatus(json.status) }
  }

  return {
    id: 'bachs',
    async createCheckout(input: CheckoutRequest): Promise<CreatedCheckout> {
      const minutes = Math.min(1440, Math.max(1, Math.trunc(input.expiresInMinutes)))
      const { json } = await request('POST', '/v1/checkout-sessions', TIMEOUTS.checkout, {
        pricing: { currency: input.currency, amount: koboToDecimal(input.amountKobo), price_type: 'fixed' },
        payment_method_types: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
        reference: input.orderId,
        metadata: { order_id: input.orderId },
        expires_in_minutes: minutes,
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
      }, `checkout-${input.orderId}`)
      const checkoutId = opaque(json.checkout_id)
      const checkoutUrl = typeof json.checkout_url === 'string' ? json.checkout_url : ''
      const expiresAt = typeof json.expires_at === 'string' && !Number.isNaN(Date.parse(json.expires_at)) ? json.expires_at : null
      let origin = ''
      try { origin = new URL(checkoutUrl).origin } catch { origin = '' }
      // Only Bachs' own hosted page, the one origin the CSP lets a form redirect to, for this order.
      if (checkoutId === null || origin !== BACHS_CHECKOUT_ORIGIN || checkoutUrl.length > 2048 || expiresAt === null
          || json.reference !== input.orderId) {
        throw new ProviderRejectedError('Bachs checkout answer did not match the request')
      }
      return { checkoutId, checkoutUrl, expiresAt }
    },

    verifyWebhook(rawBody: string, headers: Headers): WebhookCheck {
      const check = verifySignature(headers.get(SIGNATURE_HEADER), rawBody, options.webhookSecrets, Math.floor(now() / 1000))
      if (!check.ok) return check
      const event = parseEventEnvelope(rawBody)
      return event === null ? { ok: false, reason: 'malformed' } : { ok: true, event }
    },

    async getCheckout(checkoutId: string, options?: { signal?: AbortSignal }): Promise<CheckoutSnapshot> {
      if (opaque(checkoutId) === null) throw new ProviderRejectedError('Invalid checkout id')
      const { json } = await request('GET', `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, TIMEOUTS.read,
        undefined, undefined, options?.signal)
      const status = typeof json.status === 'string' ? json.status.toLowerCase() : ''
      if (json.checkout_id !== checkoutId || !['open', 'completed', 'expired', 'cancelled'].includes(status)) {
        throw new ProviderRejectedError('Bachs checkout answer did not match the request')
      }
      const charge = typeof json.charge === 'object' && json.charge !== null ? json.charge as Record<string, unknown> : null
      let payment: CheckoutSnapshot['payment'] = null
      if (charge !== null) {
        const id = opaque(charge.payment_id)
        if (id === null) throw new ProviderRejectedError('Bachs charge without a usable id')
        const paymentStatus = typeof charge.status === 'string' ? charge.status.toLowerCase() : 'unknown'
        // What arrived, not what was asked: an overpayment is granted and flagged, an underpayment is not granted.
        const received = typeof charge.amount_paid === 'string' ? charge.amount_paid
          : paymentStatus === 'succeeded' ? charge.amount : null
        payment = { id, status: paymentStatus, amountKobo: decimalToKobo(received),
          currency: typeof charge.currency === 'string' && /^[A-Z]{3}$/.test(charge.currency) ? charge.currency : null,
          method: methodOf(charge.payment_method ?? json.payment_method),
          paidAt: typeof charge.completed_at === 'string' && !Number.isNaN(Date.parse(charge.completed_at)) ? charge.completed_at : null }
      }
      return { checkoutId, status: status as CheckoutSnapshot['status'],
        reference: typeof json.reference === 'string' ? json.reference : null, payment }
    },

    async refund(input: RefundRequest): Promise<RefundSnapshot> {
      try {
        const { json } = await request('POST', '/v1/refunds', TIMEOUTS.refund, { charge_id: input.paymentId,
          reference: input.reference, reason: input.reason.slice(0, 500), idempotency_key: input.idempotencyKey,
          ...(input.amountKobo !== undefined ? { amount: koboToDecimal(input.amountKobo) } : {}) },
        input.idempotencyKey)
        return refundSnapshot(json)
      } catch (error) {
        // A refund this payment already carries (an earlier try whose answer was lost): read it back, ours or nothing.
        if (!(error instanceof ProviderRejectedError) || error.status !== 409) throw error
        const { json } = await request('GET', `/v1/refunds/by-charge/${encodeURIComponent(input.paymentId)}`, TIMEOUTS.read)
        const existing = refundSnapshot(json)
        if (existing.reference !== input.reference) throw new ProviderRejectedError('This payment already has another refund')
        return existing
      }
    },

    async getRefund(refundId: string): Promise<RefundSnapshot> {
      if (opaque(refundId) === null) throw new ProviderRejectedError('Invalid refund id')
      return refundSnapshot((await request('GET', `/v1/refunds/${encodeURIComponent(refundId)}`, TIMEOUTS.read)).json)
    },
  }
}
