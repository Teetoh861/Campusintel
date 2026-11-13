// app/api/auth/reset-password/route.ts — Use the verified recovery authorization for one password replacement.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { claimRecoveryGrant, clearRecoveryCookie, type HeldRecoveryGrant } from '@/lib/auth/recovery-grant'
import { mapAuthFailure } from '@/lib/auth/errors'
import { AUTH_MESSAGES, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'
import { PASSWORD_RESET_DESTINATION } from '@/lib/auth/constants'
import { getRecoveryAuthGateway } from '@/lib/supabase/recovery-auth'
import { advanceStudentSessionGeneration } from '@/lib/auth/session-generation'

/** A held grant that is not going back is deleted. If that fails it stays held, which no request can use. */
async function finish(grant: HeldRecoveryGrant): Promise<void> {
  await grant.finish().catch(() => undefined)
}

/** Only a verified recovery grant authorizes replacement, never an existing login. The grant is held before the
 * provider is asked, so no other request can use it, and it goes back only when the provider refuses the password
 * itself (weak or reused): nothing changed, so the student may try another on the same grant, up to five refused
 * passwords for one code.
 */
export async function POST(request: Request) {
  let grantAttempted = false
  let grant: HeldRecoveryGrant | null = null
  try {
    // The length rule is checked here, before the grant is touched.
    const body = await readAuthRequest(request, resetSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const gateway = getRecoveryAuthGateway(getRequesterAddress(request))
    grantAttempted = true
    grant = await claimRecoveryGrant(body.email)
    if (!grant) {
      const failure = authJson({ error: AUTH_MESSAGES.recoveryRestart, code: RECOVERY_FAILURE.restart }, 400)
      return failure
    }
    const { error } = await gateway.replacePasswordAndRevokeSessions(grant.userId, body.password)
    const failure = error ? mapAuthFailure(error, 'reset') : null
    if (failure?.code === RECOVERY_FAILURE.password) {
      // The same grant, for the same browser, with the expiry it always had. The cookie is left exactly as it is.
      if (await grant.restore().catch(() => false)) {
        return authJson({ error: failure.error, code: RECOVERY_FAILURE.password }, failure.status)
      }
      // It expired while the provider answered, this was the code's fifth refused password, or it could not be put
      // back: the grant is used up and recovery starts again with a new code.
      await finish(grant)
      const expired = authJson({ error: AUTH_MESSAGES.recoveryRestart, code: RECOVERY_FAILURE.restart }, 400)
      clearRecoveryCookie(expired)
      return expired
    }
    await finish(grant)
    const response = failure
      ? authJson({ error: failure.error, code: RECOVERY_FAILURE.restart }, failure.status)
      : authJson({ next: PASSWORD_RESET_DESTINATION })
    clearRecoveryCookie(response)
    if (!failure) await advanceStudentSessionGeneration(response)
    return response
  } catch (error) {
    const response = grantAttempted
      ? authJson({ error: AUTH_MESSAGES.unavailable, code: RECOVERY_FAILURE.restart }, 503)
      : authError(error)
    if (grant) {
      await finish(grant)
      clearRecoveryCookie(response)
    }
    return response
  }
}
