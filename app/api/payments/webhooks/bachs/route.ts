// app/api/payments/webhooks/bachs/route.ts — Bachs deliveries. No session and no cookies: the signature is the only
// credential, and every payment is re-verified with Bachs before anything is granted. See lib/payments/webhook.ts.
import { handleWebhook } from '@/lib/payments/routes'
import { defaultRouteDeps } from '@/lib/payments/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Bachs counts a delivery as failed after 10 seconds.
export const maxDuration = 10

export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, defaultRouteDeps())
}
