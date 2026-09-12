// app/api/auth/reset-password/route.ts — Recovery OTP authorization and password replacement in one request.
import { readAuthRequest, getRequesterAddress, AuthRequestError } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'
import { PASSWORD_RESET_DESTINATION } from '@/lib/auth/constants'
import { createClient } from '@/lib/supabase/server'

/** Only a freshly verified recovery OTP authorizes replacement, never an existing login. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, resetSchema)
    const address = getRequesterAddress(request)
    await consumeAuthLimit('PASSWORD_RESET_SUBMIT', body.email, address)
    const { data, error } = await getAuthGateway(address).verifyOtp({
      email: body.email, token: body.code, type: 'recovery',
    })
    if (error || !data.session || !data.user) throw new AuthRequestError(400, AUTH_MESSAGES.code)
    const response = authJson({ next: PASSWORD_RESET_DESTINATION })
    const client = await createClient(response)
    let passwordUpdated = false
    const unavailableMessage = 'Password reset could not be completed. Request a new code and try again.'
    let failureMessage = unavailableMessage
    let failureStatus = 503
    try {
      const { data: established, error: sessionError } = await client.auth.setSession({
        access_token: data.session.access_token, refresh_token: data.session.refresh_token,
      })
      if (sessionError || established.user?.id !== data.user.id) throw new Error('Session transfer failed')
      const { error: updateError } = await client.auth.updateUser({ password: body.password })
      passwordUpdated = !updateError
      if (updateError?.code === 'same_password') {
        failureMessage = 'Your existing password cannot be reused. Your recovery code has already been used; request a new recovery code and choose a different password.'
        failureStatus = 400
      } else if (updateError?.code === 'weak_password') {
        failureMessage = 'Choose a stronger password. Your recovery code has already been used; request a new recovery code and choose a stronger password.'
        failureStatus = 400
      }
      // Do not release a recovery session to the browser on either success or failure.
      if (updateError) throw new Error('Password update failed')
      const { error: signOutError } = await client.auth.signOut({ scope: 'global' })
      if (signOutError) throw new Error('Session revocation failed')
      return response
    } catch {
      // Best-effort revocation also covers thrown update/transfer failures. Never send staged tokens.
      try {
        const { error: cleanupError } = await client.auth.signOut({ scope: passwordUpdated ? 'global' : 'local' })
        if (cleanupError) throw new Error('Session cleanup failed')
      } catch {
        failureMessage = unavailableMessage
        failureStatus = 503
      }
      const failure = authJson({ error: failureMessage }, failureStatus)
      for (const cookie of response.cookies.getAll()) {
        failure.cookies.set({ ...cookie, value: '', maxAge: 0, expires: new Date(0) })
      }
      return failure
    }
  } catch (error) { return authError(error) }
}
