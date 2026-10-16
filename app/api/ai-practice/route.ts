// app/api/ai-practice/route.ts — Student upload-to-practice commands: reserve, process and generate.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runAiPracticeRequest } from '@/lib/ai-practice/supabase-env'
import type { AiPracticeResult } from '@/lib/ai-practice/upload-contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// One generation is bounded by the provider deadline (at most 120 s) plus extraction and database work.
export const maxDuration = 180
// Commands are small JSON objects; files never pass through this handler.
const COMMAND_MAX_BYTES = 2 * 1024

const HTTP_STATUS: Partial<Record<AiPracticeResult['status'], number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'not-eligible': 403,
  'not-entitled': 403,
  'disabled': 503,
  'unavailable': 503,
  'busy': 409,
  'capacity': 429,
  'upload-limit': 429,
  'allowance-exhausted': 402,
  'allowance-expired': 402,
}

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** Identity, course eligibility and allowance are server-owned; the body only names the action. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown(), { maxBytes: COMMAND_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  // Session refreshes are written onto this response; its headers carry them to the client.
  const carrier = NextResponse.json({})
  const result = await runAiPracticeRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER))
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
