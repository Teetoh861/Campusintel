import { NextResponse } from 'next/server'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { THEORY_BODY_MAX_BYTES, theorySubmission } from '@/lib/theory-practice/contract'
import { submitTheoryAnswer } from '@/lib/theory-practice/submit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } })
}

/** Disclose feedback for a question identity only; the student's answer is never part of the request. */
export async function POST(request: Request): Promise<Response> {
  let input
  try { input = await readAuthRequest(request, theorySubmission, { maxBytes: THEORY_BODY_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' })
  const result = await submitTheoryAnswer(input, response, request.headers.get(AUTH_CONTINUITY_HEADER))
  const status = result.status === 'ready' ? 200 : result.status === 'signed-out' ? 401
    : result.status === 'incomplete' ? 403 : result.status === 'not-found' ? 404
    : result.status === 'invalid-request' ? 400
    : ['session-changed', 'content-changed'].includes(result.status) ? 409 : 503
  return new Response(JSON.stringify(result), { status, headers: response.headers })
}
