// lib/payments/checkout.ts — Start (or resume) a provider checkout for the verified session's own order.
// The client names a plan key, the profile revision it showed, a request id and where to come back to; the price,
// currency and allowances come from the order part 1 copied out of the catalogue. Three separate steps, each its own
// transaction or call: create_payment_order, the provider call, attach_payment_checkout. A double tap or a retry reuses
// the same order (request id) and the provider's Idempotency-Key returns the same session, so it gets the same link.
import 'server-only'
import { z } from 'zod'
import { ProviderRejectedError, ProviderUnavailableError } from './provider'
import type { PaymentProvider } from './provider'
import { call, readOrder } from './rpc'
import type { PaymentRpc } from './rpc'

export const PLAN_KEYS = ['standard_semester', 'standard_session', 'plus_semester', 'plus_session'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export type CheckoutInput = { plan: PlanKey; expectedRevision: number; requestId: string; returnPath: string | null }
export type CheckoutDeps = { rpc: PaymentRpc; provider: PaymentProvider | null; origin: string; now?: () => number }
export type CheckoutResult =
  | { state: 'redirect'; url: string; orderId: string }
  | { state: 'refused'; reason: string; orderId?: string }
  | { state: 'unavailable' }

const summary = z.object({ id: z.string().uuid(), status: z.string(), amount_kobo: z.number().int().positive(),
  currency: z.literal('NGN'), provider: z.string(), expires_at: z.string(), checkout_url: z.string().nullable(),
  checkout_expires_at: z.string().nullable() })
// 'created' and 'existing' carry the order; every other state is a refusal (sales-closed, already-paid, ...).
const created = z.object({ state: z.string(), order: summary.optional() })
const attached = z.object({ state: z.string(), order: summary.optional() })

/** The page the provider sends the student back to, success or not. It reads our order only. */
export function returnUrlFor(origin: string, orderId: string): string {
  const url = new URL('/access/checkout/return', origin)
  url.searchParams.set('order', orderId)
  return url.toString()
}

function usableLink(order: z.infer<typeof summary>, now: number): string | null {
  if (order.checkout_url === null || order.checkout_expires_at === null) return null
  return Date.parse(order.checkout_expires_at) > now ? order.checkout_url : null
}

export async function startCheckout(deps: CheckoutDeps, sessionId: string, input: CheckoutInput): Promise<CheckoutResult> {
  const provider = deps.provider
  if (provider === null) return { state: 'unavailable' }
  const now = deps.now ?? Date.now
  const answer = await call(deps.rpc, 'create_payment_order', { p_session_id: sessionId, p_plan: input.plan,
    p_expected_profile_revision: input.expectedRevision, p_request_id: input.requestId,
    p_return_path: input.returnPath, p_provider: provider.id }, created)
  const order = answer.order
  if ((answer.state !== 'created' && answer.state !== 'existing') || order === undefined) {
    return { state: 'refused', reason: answer.state }
  }
  const link = usableLink(order, now())
  if (link !== null) return { state: 'redirect', url: link, orderId: order.id }
  if (order.status === 'paid') return { state: 'refused', reason: 'already-paid', orderId: order.id }
  // A replayed request id for an order whose link has lapsed, or that has ended: the confirm screen starts afresh.
  if (order.status !== 'created' || Date.parse(order.expires_at) <= now()) {
    return { state: 'refused', reason: 'checkout-expired', orderId: order.id }
  }

  const { checkoutMinutes } = await readOrder(deps.rpc, order.id)
  let checkout
  try {
    checkout = await provider.createCheckout({ orderId: order.id, amountKobo: order.amount_kobo, currency: order.currency,
      expiresInMinutes: checkoutMinutes, returnUrl: returnUrlFor(deps.origin, order.id) })
  } catch (error) {
    if (error instanceof ProviderUnavailableError || error instanceof ProviderRejectedError) {
      console.error('payments: checkout not created', error.message)
      return { state: 'unavailable' }
    }
    throw error
  }
  const stored = await call(deps.rpc, 'attach_payment_checkout', { p_order_id: order.id, p_provider: provider.id,
    p_checkout_id: checkout.checkoutId, p_checkout_url: checkout.checkoutUrl, p_checkout_expires_at: checkout.expiresAt },
  attached)
  // The stored link wins: a racing tap that attached first, or this one.
  const storedLink = stored.order ? usableLink(stored.order, now()) : null
  if ((stored.state === 'pending' || stored.state === 'unchanged' || stored.state === 'conflict') && storedLink !== null) {
    return { state: 'redirect', url: storedLink, orderId: order.id }
  }
  return { state: 'refused', reason: stored.state === 'already-final' ? 'checkout-expired' : 'unavailable', orderId: order.id }
}
