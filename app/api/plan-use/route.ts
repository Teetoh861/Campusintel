import { NextResponse } from 'next/server'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { NOTE_OPENED_MAX_BYTES, noteOpened, recordNoteOpened } from '@/lib/payments/notes-use'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } })
}

/** Record a notes topic the student opened, as plan use for the refund rules. Carries identities only. */
export async function POST(request: Request): Promise<Response> {
  let input
  try { input = await readAuthRequest(request, noteOpened, { maxBytes: NOTE_OPENED_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' })
  const result = await recordNoteOpened(input, response, request.headers.get(AUTH_CONTINUITY_HEADER))
  const status = result.status === 'recorded' ? 200 : result.status === 'signed-out' ? 401
    : result.status === 'not-found' ? 404 : result.status === 'invalid-request' ? 400
    : result.status === 'session-changed' ? 409 : 503
  return new Response(JSON.stringify(result), { status, headers: response.headers })
}
