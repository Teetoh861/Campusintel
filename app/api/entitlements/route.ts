// app/api/entitlements/route.ts — Student trial activation by phone code. Early Access needs no student command.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runEntitlementRequest } from '@/lib/entitlements/server'
import type { EntitlementResultStatus } from '@/lib/entitlements/contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Commands are tiny JSON objects: an action, a phone number or a six-digit code.
const COMMAND_MAX_BYTES = 512

const HTTP_STATUS: Partial<Record<EntitlementResultStatus, number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'invalid-phone': 400,
  'unavailable': 503,
  'capacity': 503,
  'cooldown': 429,
  'rate-limited': 429,
  'delivery-failed': 502,
  'incorrect': 422,
  'expired': 410,
  'superseded': 410,
  'already-used': 409,
  'too-many-attempts': 429,
  'already-activated': 409,
  'phone-already-used': 409,
  'early-access-active': 409,
  'trial-not-offered': 403,
}

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** Identity, phone uniqueness, limits and the Early Access overlap rule are server-owned; the body only names the action. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown(), { maxBytes: COMMAND_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  // Session refreshes are written onto this response; its headers carry them to the client.
  const carrier = NextResponse.json({})
  const result = await runEntitlementRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER))
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
