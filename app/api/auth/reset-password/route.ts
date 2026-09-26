// app/api/auth/reset-password/route.ts — Consume verified recovery authorization before password replacement.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { clearRecoveryCookie, consumeRecoveryGrant } from '@/lib/auth/recovery-grant'
import { mapAuthFailure } from '@/lib/auth/errors'
import { AUTH_MESSAGES, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'
import { PASSWORD_RESET_DESTINATION } from '@/lib/auth/constants'
import { getRecoveryAuthGateway } from '@/lib/supabase/recovery-auth'

/** Only a single-use verified recovery grant authorizes replacement, never an existing login. */
export async function POST(request: Request) {
  let grantAttempted = false
  try {
    const body = await readAuthRequest(request, resetSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const gateway = getRecoveryAuthGateway(getRequesterAddress(request))
    grantAttempted = true
    const grant = await consumeRecoveryGrant(body.email)
    if (!grant) {
      const failure = authJson({ error: AUTH_MESSAGES.recoveryRestart, code: RECOVERY_FAILURE.restart }, 400)
      clearRecoveryCookie(failure)
      return failure
    }
    const { error } = await gateway.replacePasswordAndRevokeSessions(grant.userId, body.password)
    const failure = error ? mapAuthFailure(error, 'reset') : null
    const response = failure
      ? authJson({ error: failure.error, code: RECOVERY_FAILURE.restart }, failure.status)
      : authJson({ next: PASSWORD_RESET_DESTINATION })
    clearRecoveryCookie(response)
    return response
  } catch (error) {
    const response = grantAttempted
      ? authJson({ error: AUTH_MESSAGES.unavailable, code: RECOVERY_FAILURE.restart }, 503)
      : authError(error)
    if (grantAttempted) clearRecoveryCookie(response)
    return response
  }
}
