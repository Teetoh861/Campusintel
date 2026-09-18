// app/api/auth/confirm-email/route.ts — Server authentication with HttpOnly session transfer.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_OTP_TYPES, AUTH_MESSAGES } from '@/lib/auth/constants'
import { mapAuthFailure } from '@/lib/auth/errors'
import { confirmSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { createClient } from '@/lib/supabase/server'
import { requireVerifiedSession } from '@/lib/auth/verified-session'

/** Verify credentials server-side; serialize only a validated destination. */
export async function POST(request: Request) {
  let confirmed = false
  try {
    const body = await readAuthRequest(request, confirmSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const address = getRequesterAddress(request)
    await consumeAuthLimit('CONFIRM_EMAIL', body.email, address)
    // The provider's broader "email" type also accepts recovery codes as login credentials.
    const { data, error } = await getAuthGateway(address).verifyOtp({ email: body.email, token: body.code, type: AUTH_OTP_TYPES.confirmation })
    if (error) {
      const failure = mapAuthFailure(error, 'otp')
      return authJson({ error: failure.error }, failure.status)
    }
    const session = requireVerifiedSession(data, body.email)
    confirmed = true
    const response = authJson({ next: getSafeReturnPath(body.next) })
    const client = await createClient(response)
    const { data: transferred, error: sessionError } = await client.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    })
    if (sessionError) throw new Error('Session transfer failed')
    if (requireVerifiedSession(transferred, body.email).user.id !== session.user.id) throw new Error('Session transfer identity mismatch')
    return response
  } catch (error) {
    return confirmed ? authJson({ error: AUTH_MESSAGES.confirmationSignIn }, 503) : authError(error)
  }
}
