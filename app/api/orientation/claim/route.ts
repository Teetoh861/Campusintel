import { NextResponse } from 'next/server'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { readAuthRequest, AuthRequestError } from '@/lib/auth/request'
import { getAuthenticatedMutationContext } from '@/lib/auth/mutation-context'
import { staffRequestSchema } from '@/lib/orientation/contract'
import { quizJson } from '@/lib/orientation/response'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Event staff authorization and one-time collection are checked again in the database. */
export async function POST(request: Request) {
  const carrier = NextResponse.json({})
  try {
    const input = await readAuthRequest(request,staffRequestSchema)
    const access = await getAuthenticatedMutationContext(carrier,request.headers.get(AUTH_CONTINUITY_HEADER))
    if (access.status !== 'ready') return quizJson({ message: 'Sign in again or reload this page.' },access.status === 'signed-out' ? 401 : 409,carrier.headers)
    const result = await access.context.client.rpc('orientation_staff_claim',{
      p_event: input.eventId,p_code: input.code,p_collect: input.collect })
    if (result.error) return quizJson({ message: 'Prize collection could not be opened.' },result.error.code === '42501' ? 403 : 503,carrier.headers)
    return quizJson(result.data,200,carrier.headers)
  } catch (error) {
    return quizJson({ message: 'Prize collection could not be opened.' },error instanceof AuthRequestError ? error.status : 503,carrier.headers)
  }
}
