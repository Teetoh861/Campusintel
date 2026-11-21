// app/api/practice/route.ts — Start, resume, save, sync, submit or (instant feedback) pick on one of the student's own
// server-run practice attempts.
// The body names the course (start only), the attempt and the student's choices; the student, the questions, the
// deadline, the size, the duration and every grade come from the server and the database.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runPracticeRequest } from '@/lib/practice/server'
import type { PracticeResultStatus } from '@/lib/practice/contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// An attempt id, a tab and up to a hundred changed answers keyed by question id (about 42 bytes each).
const COMMAND_MAX_BYTES = 8192

const HTTP_STATUS: Partial<Record<PracticeResultStatus, number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'conflict': 409,
  // Practice waits for the open exam: the body names it to resume.
  'exam-open': 409,
  'locked': 403,
  'questions-changed': 409,
  'policy-changed': 409,
  'too-many-tabs': 409,
  // A different choice after the lock: the body carries the original result.
  'answer-locked': 409,
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
  const result = await runPracticeRequest(input, carrier, request.headers.get(AUTH_CONTINUITY_HEADER))
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
