// Authenticated transport for the server-owned current-student profile domain.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readAuthRequest, AuthRequestError } from '@/lib/auth/request'
import { getCurrentStudentProfile, saveCurrentStudentProfileSelection } from '@/lib/profile/student-profile'
import type { StudentProfileState } from '@/lib/profile/student-profile'

export const dynamic = 'force-dynamic'

function privateJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  } })
}

function finish(response: NextResponse, state: StudentProfileState): Response {
  const status = state.status === 'signed-out' ? 401
    : state.status === 'invalid-selection' ? 400
    : state.status === 'missing-profile' || state.status === 'invariant-failure' ? 409
    : state.status === 'unavailable' ? 503 : 200
  // Keep the exact response headers, including any session rotation/clearing cookies.
  return new Response(JSON.stringify(state), { status, headers: response.headers })
}

/** Load the live student's selection and database-backed choices. */
export async function GET(): Promise<Response> {
  const response = privateJson({ status: 'unavailable' })
  return finish(response, await getCurrentStudentProfile(response))
}

/** Accept a bounded same-origin JSON selection; the domain owns all identity checks. */
export async function PUT(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown()) }
  catch (error) {
    if (error instanceof AuthRequestError) {
      return error.status === 503
        ? privateJson({ status: 'unavailable' }, 503)
        : privateJson({ status: 'invalid-request' }, error.status)
    }
    return privateJson({ status: 'unavailable' }, 503)
  }
  const response = privateJson({ status: 'unavailable' })
  return finish(response, await saveCurrentStudentProfileSelection(input, response))
}
