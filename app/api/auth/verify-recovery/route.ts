// app/api/auth/verify-recovery/route.ts — Verify an OTP without creating a student session.
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getRecoveryAuthGateway } from '@/lib/supabase/recovery-auth'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { recoveryVerificationSchema } from '@/lib/auth/schemas'
import { mapAuthFailure } from '@/lib/auth/errors'
import { AUTH_OTP_TYPES, AUTH_MESSAGES, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { clearRecoveryCookie, discardRecoveryGrant, issueRecoveryGrant } from '@/lib/auth/recovery-grant'
import { requireVerifiedSession } from '@/lib/auth/verified-session'

/** Only a successful provider verification can issue a recovery-only grant. */
export async function POST(request: Request) {
  let accepted = false
  let verified = false
  try {
    const body = await readAuthRequest(request, recoveryVerificationSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    accepted = true
    await discardRecoveryGrant()
    const address = getRequesterAddress(request)
    await consumeAuthLimit('PASSWORD_RESET_SUBMIT', body.email, address)
    const { data, error } = await getAuthGateway(address).verifyOtp({ email: body.email, token: body.code, type: AUTH_OTP_TYPES.recovery })
    if (error) {
      const failure = mapAuthFailure(error, 'recoveryOtp')
      const response = authJson({ error: failure.error }, failure.status)
      clearRecoveryCookie(response)
      return response
    }
    verified = true
    if (!data.session) throw new Error('Recovery session missing')
    await getRecoveryAuthGateway(address).revokeTemporarySession(data.session.access_token)
    const session = requireVerifiedSession(data, body.email)
    const response = authJson({ verified: true })
    await issueRecoveryGrant({ userId: session.user.id, email: body.email }, response)
    return response
  } catch (error) {
    const response = verified ? authJson({ error: AUTH_MESSAGES.unavailable, code: RECOVERY_FAILURE.restart }, 503) : authError(error)
    if (accepted) clearRecoveryCookie(response)
    return response
  }
}
