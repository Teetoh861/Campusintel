// app/api/payments/orders/[id]/route.ts — The signed-in student's own order, as our database states it (no-store).
// Another student's order and an unknown id look the same.
import { handleOrderRead } from '@/lib/payments/routes'
import { defaultRouteDeps } from '@/lib/payments/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  return handleOrderRead(request, id, defaultRouteDeps())
}
