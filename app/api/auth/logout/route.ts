// app/api/auth/logout/route.ts — Same-origin current-session logout only.
import { clearRecoveryCookie, discardRecoveryGrant } from '@/lib/auth/recovery-grant'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { authJson } from '@/lib/auth/response'
import { safeAuthMessage } from '@/lib/auth/errors'
import { AUTH_CONTINUITY_HEADER, AUTH_MESSAGES } from '@/lib/auth/constants'
import { getAuthenticatedMutationContext } from '@/lib/auth/mutation-context'
import { finalizeMutationResponse } from '@/lib/auth/mutation-response'
import { logoutSchema } from '@/lib/auth/schemas'

/** Revoke the current session without signing other devices out. */
export async function POST(request: Request) {
  const response = authJson({ success: true })
  try {
    await readAuthRequest(request, logoutSchema)
    const mutation = await getAuthenticatedMutationContext(response, request.headers.get(AUTH_CONTINUITY_HEADER))
    // Live validation found no valid user; SDK cleanup also removes dead cookie
    // credentials that the lookup may have retained (for example user_not_found).
    if (mutation.status === 'signed-out') {
      await discardRecoveryGrant()
      clearRecoveryCookie(response)
      const { error } = await mutation.client.auth.signOut({ scope: 'local' })
      if (error) throw new Error('Sign out failed')
      return finalizeMutationResponse(response, { success: true })
    }
    if (mutation.status === 'session-changed') return finalizeMutationResponse(response,
      { status: 'session-changed', error: AUTH_MESSAGES.sessionChanged }, 409)
    if (mutation.status !== 'ready') return finalizeMutationResponse(response, { error: AUTH_MESSAGES.unavailable }, 503)
    await discardRecoveryGrant()
    clearRecoveryCookie(response)
    const { error } = await mutation.context.client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Sign out failed')
    return finalizeMutationResponse(response, { success: true })
  } catch (error) {
    return finalizeMutationResponse(response,
      { error: error instanceof AuthRequestError ? safeAuthMessage(error.message) : AUTH_MESSAGES.unavailable },
      error instanceof AuthRequestError ? error.status : 503)
  }
}
