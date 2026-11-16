// lib/payments/routes.ts — Request handling for the payment routes, with every outside dependency injected.
// Checkout is a same-origin form POST (a 303 to the hosted page is a top-level navigation, which is what the CSP
// form-action entry allows); the order route answers the order's own student only, from our database; the webhook
// takes no session; reconcile takes the cron bearer only.
import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_KEYS, startCheckout } from './checkout'
import type { PaymentProvider } from './provider'
import type { PaymentRpc } from './rpc'
import { reconcileOrders, takeReturnVerifySlot, verifyOrder } from './verify'
import { handleDelivery } from './webhook'

export type StudentSession = { userId: string; sessionId: string; readOwnOrder(orderId: string): Promise<unknown> }
export type RouteDeps = {
  rpc: PaymentRpc
  checkoutProvider: PaymentProvider | null
  providerFor(id: string): PaymentProvider | null
  origin: string
  resolveStudent(response: NextResponse, continuity: string | null): Promise<StudentSession | 'signed-out' | 'session-changed'>
  cronSecret: string | undefined
  isTrustedOrigin?(origin: string | null): boolean
  now?: () => number
}

const FORM_MAX_BYTES = 2048
const MIN_CRON_SECRET_BYTES = 32
const RECONCILE_BUDGET_MS = 40_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The same rule the database applies (payment_return_path_ok), checked first so a bad path is a refusal, not an error.
const RETURN_PATH = /^(?!.*\/\/)(?!.*\\)(?![^?#]*:)\/[^\s\u0000-\u001f\u007f]{0,199}$/

const checkoutForm = z.object({
  plan: z.enum(PLAN_KEYS),
  expected_profile_revision: z.string().regex(/^\d{1,15}$/).transform(Number),
  request_id: z.string().regex(UUID),
  return_path: z.string().regex(RETURN_PATH).optional(),
  continuity: z.string().min(1).max(512),
})

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** 303 to the hosted checkout, or back to our own confirm screen with the reason (never to a client-chosen URL). */
function seeOther(location: string, carrier?: Headers): Response {
  const headers = new Headers(carrier)
  headers.delete('content-type')
  headers.delete('content-length')
  headers.set('Location', location)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(null, { status: 303, headers })
}

function confirmScreen(origin: string, status: string, plan?: string): string {
  const url = new URL('/access/checkout', origin)
  if (plan) url.searchParams.set('plan', plan)
  url.searchParams.set('status', status)
  return url.toString()
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null
  const text = await request.text().catch(() => null)
  if (text === null || Buffer.byteLength(text) > FORM_MAX_BYTES) return null
  return new URLSearchParams(text)
}

export async function handleCheckout(request: Request, deps: RouteDeps): Promise<Response> {
  const trusted = deps.isTrustedOrigin ?? (origin => origin === new URL(deps.origin).origin)
  if (!trusted(request.headers.get('origin')) ||
      ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) {
    return privateJson({ status: 'forbidden' }, 403)
  }
  const form = await readForm(request)
  const fields = form === null ? null : Object.fromEntries(form)
  const parsed = fields === null ? null : checkoutForm.safeParse(fields)
  // A refused form still goes back to its own plan's confirm screen, the only place the reason can be shown.
  if (!parsed?.success) {
    return seeOther(confirmScreen(deps.origin, 'invalid-request', PLAN_KEYS.find(key => key === fields?.plan)))
  }
  const input = parsed.data
  const carrier = NextResponse.json({})
  try {
    const student = await deps.resolveStudent(carrier, input.continuity)
    if (student === 'signed-out' || student === 'session-changed') {
      return seeOther(confirmScreen(deps.origin, student, input.plan), carrier.headers)
    }
    const result = await startCheckout({ rpc: deps.rpc, provider: deps.checkoutProvider, origin: deps.origin, now: deps.now },
      student.sessionId, { plan: input.plan, expectedRevision: input.expected_profile_revision, requestId: input.request_id,
        returnPath: input.return_path ?? null })
    if (result.state === 'redirect') return seeOther(result.url, carrier.headers)
    return seeOther(confirmScreen(deps.origin, result.state === 'refused' ? result.reason : 'unavailable', input.plan),
      carrier.headers)
  } catch (error) {
    console.error('payments: checkout failed', error instanceof Error ? error.name : 'unknown')
    return seeOther(confirmScreen(deps.origin, 'unavailable', input.plan), carrier.headers)
  }
}

const ownOrder = z.object({ state: z.string() }).passthrough()

/** The student's own order as our database states it. While it is still confirming, ask the provider at most once
 *  per order per 10 seconds (the return page's check), then read our database again. */
export async function handleOrderRead(request: Request, orderId: string, deps: RouteDeps): Promise<Response> {
  const carrier = NextResponse.json({})
  try {
    const student = await deps.resolveStudent(carrier, null)
    if (student === 'signed-out' || student === 'session-changed') return privateJson({ state: 'signed-out' }, 401, carrier.headers)
    if (!UUID.test(orderId)) return privateJson({ state: 'not-found' }, 404, carrier.headers)
    let order = ownOrder.parse(await student.readOwnOrder(orderId))
    if (order.state === 'not-found') return privateJson(order, 404, carrier.headers)
    if (order.state === 'confirming' && takeReturnVerifySlot(orderId, (deps.now ?? Date.now)())) {
      try {
        await verifyOrder({ rpc: deps.rpc, providerFor: deps.providerFor }, orderId, 'return', 'system:return')
        order = ownOrder.parse(await student.readOwnOrder(orderId))
      } catch (error) {
        // The webhook and reconcile still settle it; the student keeps seeing "confirming".
        console.error('payments: return verify failed', error instanceof Error ? error.name : 'unknown')
      }
    }
    return privateJson(order, 200, carrier.headers)
  } catch (error) {
    console.error('payments: order read failed', error instanceof Error ? error.name : 'unknown')
    return privateJson({ state: 'unavailable' }, 503, carrier.headers)
  }
}

export async function handleWebhook(request: Request, deps: RouteDeps): Promise<Response> {
  const provider = deps.providerFor('bachs') ?? (deps.checkoutProvider?.id === 'fake' ? deps.checkoutProvider : null)
  const answer = await handleDelivery({ rpc: deps.rpc, provider, providerFor: deps.providerFor }, request)
  return privateJson(answer.body, answer.status)
}

export function isAuthorizedCronRequest(header: string | null, secret: string | undefined): boolean {
  if (!secret || Buffer.byteLength(secret) < MIN_CRON_SECRET_BYTES || !header?.startsWith('Bearer ')) return false
  const expected = Buffer.from(secret)
  const supplied = Buffer.from(header.slice('Bearer '.length))
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export async function handleReconcile(request: Request, deps: RouteDeps): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), deps.cronSecret)) {
    return privateJson({ status: 'unauthorized' }, 401)
  }
  const now = deps.now ?? Date.now
  try {
    // The daily run includes the late check; a frequent schedule passes ?late=0 so it runs once a day only.
    const includeLate = new URL(request.url).searchParams.get('late') !== '0'
    const summary = await reconcileOrders({ rpc: deps.rpc, providerFor: deps.providerFor },
      { includeLate, deadline: now() + RECONCILE_BUDGET_MS, now })
    return privateJson({ status: 'ok', ...summary }, 200)
  } catch (error) {
    console.error('payments: reconcile failed', error instanceof Error ? error.name : 'unknown')
    return privateJson({ status: 'unavailable' }, 503)
  }
}
