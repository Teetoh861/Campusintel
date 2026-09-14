// app/api/auth/login/route.ts — Server authentication with HttpOnly session transfer.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { EMAIL_CONFIRMATION_REQUIRED, type ConfirmationDelivery } from '@/lib/auth/constants'
import { mapAuthFailure } from '@/lib/auth/errors'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { createClient } from '@/lib/supabase/server'

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
        let delivery: ConfirmationDelivery = 'failed'
        try {
          await consumeAuthLimit('RESEND_CONFIRMATION', body.email, address)
          const { error: resendError } = await getAuthGateway(address).resend({ type: 'signup', email: body.email })
          delivery = !resendError ? 'fresh' : mapAuthFailure(resendError, 'login').status === 429 ? 'limited' : 'failed'
        } catch (resendError) {
          // Only a controlled limiter status is meaningful; never serialize its details.
          delivery = resendError instanceof Error && 'status' in resendError && resendError.status === 429 ? 'limited' : 'failed'
        }
        return authJson({ code: failure.code, delivery })
      }
      return authJson({ error: failure.error }, failure.status)
    }
    if (!data.session) throw new Error('Session missing')
    const response = authJson({ next: getSafeReturnPath(body.next) })
    const client = await createClient(response)
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    })
    if (sessionError) throw new Error('Session transfer failed')
    return response
  } catch (error) { return authError(error) }
}
