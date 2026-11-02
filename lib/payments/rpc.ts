// lib/payments/rpc.ts — The database calls payments make, through one injected function so the routes (supabase-js,
// service role) and the operator tool (PostgREST with the secret key) run the same code. Every call is a part 1
// definer function; each one commits on its own, so no database lock is ever held while a provider is called.
import 'server-only'
import { z } from 'zod'

export type PaymentRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>

/** The database answered with an error or with something we cannot read: transient for the caller. */
export class PaymentStoreError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentStoreError' }
}

const uuid = z.string().uuid()
const orderRow = z.object({
  id: uuid, provider: z.string(), status: z.string(), amount_kobo: z.number().int(), currency: z.string(),
  checkout_id: z.string().nullable(), checkout_expires_at: z.string().nullable(), expires_at: z.string(),
  created_at: z.string(),
  payments: z.array(z.object({ id: uuid, provider: z.string(), provider_payment_id: z.string(), method: z.string(),
    outcome: z.string(), amount_kobo: z.number(), currency: z.string() })),
  refunds: z.array(z.object({ id: uuid, payment_id: uuid, refund_class: z.string(), request_id: uuid,
    amount_kobo: z.number(), requested_at: z.string(), status: z.string(), reason: z.string(), created_at: z.string() })),
})
const statusRow = z.object({ policy: z.object({ checkout_minutes: z.number().int() }), orders: z.array(orderRow) })
export type OrderRecord = z.infer<typeof orderRow>

export async function call<T>(rpc: PaymentRpc, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  let data: unknown
  try { data = await rpc(fn, args) } catch (error) {
    // The caller's message names the function and the database's reason (never row data); routes log the name only.
    throw error instanceof PaymentStoreError ? error : new PaymentStoreError(error instanceof Error ? error.message : `${fn} failed`)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new PaymentStoreError(`${fn} returned an unexpected answer`)
  return parsed.data
}

/** The server's own view of one order (service role): status, checkout, payments and refunds, plus the checkout
 *  lifetime setting. Never sent to a student. */
export async function readOrder(rpc: PaymentRpc, orderId: string):
  Promise<{ order: OrderRecord | null; checkoutMinutes: number }> {
  const status = await call(rpc, 'admin_payment_status', { p_user_id: null, p_order_id: orderId }, statusRow)
  return { order: status.orders[0] ?? null, checkoutMinutes: status.policy.checkout_minutes }
}
