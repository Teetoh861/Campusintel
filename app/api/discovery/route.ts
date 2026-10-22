// app/api/discovery/route.ts — Open the Discovery Pass exam or topic, save the open exam's answers, or grade it. The body
// names the course, the action and (for the topic) the student's choice only; the student, the pass window, the exam
// deadline, the limits and the material all come from the server and the database.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runDiscoveryRequest } from '@/lib/entitlements/discovery'
import type { DiscoveryResultStatus } from '@/lib/entitlements/discovery-contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A course slug and up to a hundred answers keyed by question id (about 42 bytes each).
const COMMAND_MAX_BYTES = 8192

const HTTP_STATUS: Partial<Record<DiscoveryResultStatus, number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'free-course': 409,
  'full-access': 409,
  'no-pass': 403,
  'expired': 403,
  'used-elsewhere': 409,
  'not-enough-time': 409,
  'nothing-to-preview': 404,
  'not-opened': 409,
  'too-many-tabs': 409,
  'unavailable': 503,
}

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown(), { maxBytes: COMMAND_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  // Session refreshes are written onto this response; its headers carry them to the client.
  const carrier = NextResponse.json({})
  const result = await runDiscoveryRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER))
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
