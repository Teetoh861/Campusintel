// app/api/payments/checkout/route.ts — Start a plan checkout: a same-origin form POST naming a plan key, the profile
// revision the confirm screen showed, a request id and a return path. The price comes from our order, never the
// client. Answers 303 to the hosted checkout, or 303 back to the confirm screen with the reason.
import { handleCheckout } from '@/lib/payments/routes'
import { defaultRouteDeps } from '@/lib/payments/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return handleCheckout(request, defaultRouteDeps())
}
