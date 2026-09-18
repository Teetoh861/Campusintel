// app/api/auth/login/route.ts — Server authentication with HttpOnly session transfer.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_OTP_TYPES, EMAIL_CONFIRMATION_REQUIRED } from '@/lib/auth/constants'
import { mapAuthFailure, classifyEmailInitiation } from '@/lib/auth/errors'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { createClient } from '@/lib/supabase/server'
import { requireVerifiedSession } from '@/lib/auth/verified-session'
import { checkResendAcknowledgment } from '@/lib/auth/signup-result'

/** Verify credentials server-side; serialize only a validated destination. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, loginSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const address = getRequesterAddress(request)
    await consumeAuthLimit('LOGIN', body.email, address)
    const { data, error } = await getAuthGateway(address).signInWithPassword({ email: body.email, password: body.password })
    if (error) {
      const failure = mapAuthFailure(error, 'login')
      if (failure.code === EMAIL_CONFIRMATION_REQUIRED) {
        await consumeAuthLimit('RESEND_CONFIRMATION', body.email, address)
        const { data: resendData, error: resendError } = await getAuthGateway(address).resend({ type: AUTH_OTP_TYPES.confirmation, email: body.email })
        const resendFailure = classifyEmailInitiation(resendError, 'resend')
        if (resendFailure) return authJson({ error: resendFailure.error }, resendFailure.status)
        if (resendError === null) checkResendAcknowledgment(resendData)
        return authJson({ code: failure.code })
      }
      return authJson({ error: failure.error }, failure.status)
    }
    const session = requireVerifiedSession(data, body.email)
    const response = authJson({ next: getSafeReturnPath(body.next) })
    const client = await createClient(response)
    const { data: transferred, error: sessionError } = await client.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    })
    if (sessionError) throw new Error('Session transfer failed')
    if (requireVerifiedSession(transferred, body.email).user.id !== session.user.id) throw new Error('Session transfer identity mismatch')
    return response
  } catch (error) { return authError(error) }
}
