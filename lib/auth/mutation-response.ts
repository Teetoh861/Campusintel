import 'server-only'
import { NextResponse } from 'next/server'
import { authUnavailableBody, type AuthUnavailableContext } from './unavailable'

/** Replace only the body/status of this request's response, retaining its legitimate cookie/header changes.
 * Never use this to salvage an unverified login or confirmation session transfer.
 */
export function finalizeMutationResponse(
  response: NextResponse, body: Record<string, unknown>, status = 200, unavailable?: AuthUnavailableContext,
): NextResponse {
  return NextResponse.json(authUnavailableBody(body, status, unavailable), { status, headers: response.headers })
}
