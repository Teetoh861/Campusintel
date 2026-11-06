// lib/payments/order-view.ts — The student's own order as the return page shows it (get_my_payment_order through
// GET /api/payments/orders/[id]). Client-safe: our database's state only, never the provider's redirect.
import { z } from 'zod'

const timestamp = z.string().min(1)
export const ORDER_STATES = ['confirming', 'paid', 'failed', 'cancelled', 'paid-duplicate', 'refund-pending', 'refunded'] as const
export const orderView = z.object({
  state: z.enum(ORDER_STATES), order_id: z.string().uuid(),
  plan: z.enum(['standard_semester', 'standard_session', 'plus_semester', 'plus_session']),
  tier: z.enum(['standard', 'plus']), period: z.enum(['semester', 'session']),
  amount_kobo: z.number().int().positive(), created_at: timestamp, paid_at: timestamp.nullable(),
  ends_at: timestamp.nullable(), second_starts_at: timestamp.nullable(), second_ends_at: timestamp.nullable(),
}).passthrough()
export type OrderView = z.infer<typeof orderView>
export type OrderRead = { kind: 'order'; order: OrderView } | { kind: 'not-found' | 'signed-out' | 'unavailable' }

/** One answer from the order endpoint or the server render, read strictly: anything unexpected is unavailable. */
export function readOrderAnswer(status: number, body: unknown): OrderRead {
  if (status === 401) return { kind: 'signed-out' }
  if (status === 404) return { kind: 'not-found' }
  if (body !== null && typeof body === 'object' && 'state' in body && body.state === 'not-found') return { kind: 'not-found' }
  const parsed = orderView.safeParse(body)
  return parsed.success ? { kind: 'order', order: parsed.data } : { kind: 'unavailable' }
}
