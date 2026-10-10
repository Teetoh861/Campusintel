import { NextResponse } from 'next/server'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { questionReportInput } from '@/lib/question-reports/input'
import { submitCurrentStudentReport } from '@/lib/question-reports/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function privateJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } })
}

/** Accept only bounded same-origin JSON; never accept an account ID or return content payloads. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, questionReportInput) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' }, 503)
  const result = await submitCurrentStudentReport(input, response, request.headers.get(AUTH_CONTINUITY_HEADER))
  const status = result.status === 'reported' ? 201 : result.status === 'already-reported' ? 200
    : result.status === 'signed-out' ? 401 : result.status === 'session-changed' ? 409
    : result.status === 'invalid-request' ? 400 : result.status === 'limited' ? 429 : 503
  return new Response(JSON.stringify(result), { status, headers: response.headers })
}
