import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { writeCurrentStudentAttempt } from '@/lib/quiz-attempts/current-student-attempt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The existing Auth parser has a 4 KiB limit, too small for a 50-answer patch.
// Share the trusted-origin/stream reader with a quiz-specific bound.
const QUIZ_BODY_MAX_BYTES = 16 * 1024

function privateJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } })
}

function finish(response: NextResponse, state: { status: string }): Response {
  const status = state.status === 'signed-out' ? 401
    : state.status === 'invalid-request' ? 400
    : state.status === 'not-found' ? 404
    : ['session-changed', 'conflict', 'finalized'].includes(state.status) ? 409
    : state.status === 'unavailable' ? 503 : 200
  return new Response(JSON.stringify(state), { status, headers: response.headers })
}

/** Start, patch or finish an attempt. Identity and quiz metadata are server-owned. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown(), { maxBytes: QUIZ_BODY_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' })
  return finish(response, await writeCurrentStudentAttempt(input, response, request.headers.get(AUTH_CONTINUITY_HEADER)))
}
