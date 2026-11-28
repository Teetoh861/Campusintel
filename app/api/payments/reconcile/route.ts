// app/api/payments/reconcile/route.ts — Scheduled catch-up for orders the webhook has not settled, through the same
// fulfil path. Invoke with `Authorization: Bearer $CRON_SECRET` (the Vercel Cron convention). Each run includes the
// 14-day late check unless `?late=0`. See docs/payments-operations.md for the schedule.
import { handleReconcile } from '@/lib/payments/routes'
import { defaultRouteDeps } from '@/lib/payments/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  return handleReconcile(request, defaultRouteDeps())
}
