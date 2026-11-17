// app/api/entitlements/route.ts — The signed-in student's two commands: start a Discovery Pass, claim a free month
// (Early Access). The body names the action and the profile revision the page showed, and nothing else: the student,
// the limits, every window and every start and end time come from the server and the database clock.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, getRequesterAddress, readAuthRequest } from '@/lib/auth/request'
import { runEntitlementRequest } from '@/lib/entitlements/server'
import type { EntitlementResultStatus } from '@/lib/entitlements/contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The command is a tiny JSON object naming the action.
const COMMAND_MAX_BYTES = 256

const HTTP_STATUS: Partial<Record<EntitlementResultStatus, number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'unavailable': 503,
  'capacity': 503,
  'rate-limited': 429,
  'already-activated': 409,
  'already-claimed': 409,
  'early-access-active': 409,
  'trial-not-offered': 403,
  'selection-changed': 409,
  'offer-ended': 409,
  'offer-unavailable': 403,
}

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** Identity, the one-per-account rules, the request limits and the claim window are server-owned. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  let address: string
  try {
    input = await readAuthRequest(request, z.unknown(), { maxBytes: COMMAND_MAX_BYTES })
    address = getRequesterAddress(request)
  } catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  // Session refreshes are written onto this response; its headers carry them to the client.
  const carrier = NextResponse.json({})
  const result = await runEntitlementRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER), address)
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
