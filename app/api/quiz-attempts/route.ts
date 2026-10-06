import { NextResponse } from 'next/server'
import { getAuthOrigin, isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError } from '@/lib/auth/request'
import { writeCurrentStudentAttempt } from '@/lib/quiz-attempts/current-student-attempt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The existing Auth parser has a 4 KiB limit, too small for a 50-answer patch.
// Keep the same origin/stream validation pattern with a quiz-specific bound.
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

async function readWriteRequest(request: Request): Promise<unknown> {
  if (!isStudentAuthEnabled()) throw new AuthRequestError(503, 'Unavailable')
  if (request.headers.get('origin') !== getAuthOrigin() ||
      ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '')) {
    throw new AuthRequestError(403, 'Invalid origin')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthRequestError(415, 'Invalid content type')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new AuthRequestError(400, 'Invalid body')
  let length = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > QUIZ_BODY_MAX_BYTES) {
        await reader.cancel()
        throw new AuthRequestError(413, 'Invalid body')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof AuthRequestError) throw error
    throw new AuthRequestError(400, 'Invalid body')
  } finally { reader.releaseLock() }
}

/** Start, patch or finish an attempt. Identity and quiz metadata are server-owned. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readWriteRequest(request) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' })
  return finish(response, await writeCurrentStudentAttempt(input, response, request.headers.get(AUTH_CONTINUITY_HEADER)))
}
