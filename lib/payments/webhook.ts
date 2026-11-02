// lib/payments/webhook.ts — A Bachs delivery: raw body first (at most 64 KB), signature, then the event is stored once
// (deduplicated by its id), then the order is re-verified with Bachs and fulfilled through the one fulfil path. The body
// is a doorbell, never evidence: only its id, type and references are read, and nothing in it is stored except its
// SHA-256. Answers: 2xx once stored and handled, 400 for a delivery we refuse (Bachs stops), 413 for an oversized body,
// 5xx for our own transient failure so Bachs retries. A retried event is stored as a duplicate and handled again,
// which is safe because fulfilment returns its first answer.
import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ProviderRejectedError } from './provider'
import type { PaymentProvider, WebhookEvent } from './provider'
import { call } from './rpc'
import type { PaymentRpc } from './rpc'
import { verifyOrder } from './verify'

export const WEBHOOK_MAX_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORDER_EVENTS = new Set(['checkout.completed', 'checkout.expired', 'collection.succeeded', 'collection.failed',
  'collection.underpaid'])
const REFUND_EVENTS = new Set(['refund.created', 'refund.paid', 'refund.failed'])

export type WebhookDeps = { rpc: PaymentRpc; provider: PaymentProvider | null; providerFor(id: string): PaymentProvider | null }
export type WebhookAnswer = { status: number; body: Record<string, unknown> }

/** The raw body, or null when it is larger than the limit (read no further than that). */
export async function readRawBody(request: Request, maxBytes: number = WEBHOOK_MAX_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) { await reader.cancel(); return null }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}

// A refused delivery is logged without its body, at most once a minute per reason, so a flood cannot fill the logs.
const lastRejectionLog = new Map<string, number>()
function logRejection(reason: string, now: number = Date.now()): void {
  if (now - (lastRejectionLog.get(reason) ?? 0) < 60_000) return
  lastRejectionLog.set(reason, now)
  console.error('payments: webhook refused', reason)
}

const recorded = z.object({ state: z.enum(['recorded', 'duplicate']) }).passthrough()
const refundResult = z.object({ state: z.string() }).passthrough()

async function handleRefundEvent(deps: WebhookDeps, provider: PaymentProvider, event: WebhookEvent): Promise<void> {
  if (event.refundId === null || provider.getRefund === undefined) return
  const refund = await provider.getRefund(event.refundId)
  // Our refund id is the reference we gave Bachs; anything else is not one of ours to settle.
  if (refund.status === 'pending' || refund.reference === null || !UUID.test(refund.reference)) return
  await call(deps.rpc, 'record_refund_result', { p_refund_id: refund.reference, p_outcome: refund.status,
    p_provider_refund_id: refund.refundId, p_manual_reference: null, p_actor: 'system:webhook' }, refundResult)
}

export async function handleDelivery(deps: WebhookDeps, request: Request): Promise<WebhookAnswer> {
  const provider = deps.provider
  if (provider === null) return { status: 503, body: { received: false } }
  const raw = await readRawBody(request)
  if (raw === null) { logRejection('too-large'); return { status: 413, body: { received: false } } }
  const check = provider.verifyWebhook(raw, request.headers)
  if (!check.ok) { logRejection(check.reason); return { status: 400, body: { received: false } } }
  const event = check.event
  const orderId = event.reference !== null && UUID.test(event.reference) ? event.reference.toLowerCase() : null
  try {
    const stored = await call(deps.rpc, 'record_payment_event', { p_provider: provider.id, p_provider_event_id: event.id,
      p_event_type: event.type, p_order_id: ORDER_EVENTS.has(event.type) ? orderId : null,
      p_body_hash: createHash('sha256').update(raw, 'utf8').digest('hex') }, recorded)
    if (ORDER_EVENTS.has(event.type) && orderId !== null) {
      const result = await verifyOrder({ rpc: deps.rpc, providerFor: id => id === provider.id ? provider : deps.providerFor(id) },
        orderId, 'webhook', 'system:webhook', { checkoutHint: event.checkoutId })
      return { status: 200, body: { received: true, duplicate: stored.state === 'duplicate', result: result.state } }
    }
    if (REFUND_EVENTS.has(event.type)) await handleRefundEvent(deps, provider, event)
    return { status: 200, body: { received: true, duplicate: stored.state === 'duplicate' } }
  } catch (error) {
    // A checkout or refund Bachs says does not exist will not appear on a retry: stored, nothing to do.
    if (error instanceof ProviderRejectedError && error.status === 404) return { status: 200, body: { received: true } }
    console.error('payments: webhook handling failed', error instanceof Error ? error.name : 'unknown')
    return { status: 503, body: { received: false } }
  }
}
