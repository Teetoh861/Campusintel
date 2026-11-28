// app/api/campus-bot/route.ts — Campus Bot Explain and Ask Campus Bot. The body names an attempt and a question, or a
// topic and what the student typed; the student, the access, the answer key, the notes and every limit come from the
// server and the database (lib/campus-bot/server.ts).
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runCampusBotRequest } from '@/lib/campus-bot/server'
import type { CampusBotResult } from '@/lib/campus-bot/contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// An explanation and its check are bounded by their own deadlines (25 s and 35 s) plus the database work around them.
export const maxDuration = 120
// 500 new characters + twelve turns of 600 and checks of 300: 11,300 UTF-16 units. JSON may escape each as six
// ASCII bytes (67,800), plus the bounded identifiers, action and structure. The strict command schema still limits fields.
const COMMAND_MAX_BYTES = 72 * 1024

const HTTP_STATUS: Partial<Record<CampusBotResult['status'], number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'locked': 403,
  'not-entitled': 403,
  'exam-open': 409,
  'in-progress': 409,
  'limit': 429,
  'busy': 503,
  'disabled': 503,
  'unavailable': 503,
  'failed': 502,
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
  const result = await runCampusBotRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER))
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
