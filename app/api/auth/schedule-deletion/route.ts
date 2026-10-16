import { AUTH_CONTINUITY_HEADER, AUTH_MESSAGES } from '@/lib/auth/constants'
import { scheduleDeletionSchema } from '@/lib/auth/schemas'
import { readAuthRequest, getRequesterAddress, AuthRequestError } from '@/lib/auth/request'
import { authJson } from '@/lib/auth/response'
import { safeAuthMessage } from '@/lib/auth/errors'
import { getAuthenticatedMutationContext } from '@/lib/auth/mutation-context'
import { finalizeMutationResponse } from '@/lib/auth/mutation-response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { advanceStudentSessionGeneration } from '@/lib/auth/session-generation'
import { clearRecoveryCookie } from '@/lib/auth/recovery-grant'
import { scheduleStudentDeletion } from '@/lib/account/deletion-server'
import { ACCOUNT_DELETION_SCHEDULED_PATH } from '@/lib/account/constants'

/** Require this rendered session AND the current password before any deletion request. */
export async function POST(request: Request) {
  const response = authJson({})
  try {
    const body = await readAuthRequest(request, scheduleDeletionSchema)
    const mutation = await getAuthenticatedMutationContext(response, request.headers.get(AUTH_CONTINUITY_HEADER), { allowRestricted: true })
    if (mutation.status === 'session-changed') return finalizeMutationResponse(response, { status: 'session-changed' }, 409)
    if (mutation.status !== 'ready') return finalizeMutationResponse(response,
      { error: AUTH_MESSAGES.unavailable }, mutation.status === 'signed-out' ? 401 : 503)
    const { context } = mutation
    const address = getRequesterAddress(request)
    if (!context.user.email) throw new Error('Account email unavailable')
    await consumeAuthLimit('ACCOUNT_DELETION', context.user.email.toLowerCase(), address)
    const result = await scheduleStudentDeletion(context, body.password, address)
    if (result.status === 'password-invalid') return finalizeMutationResponse(response, { error: AUTH_MESSAGES.deletionPassword }, 400)
    if (result.status === 'operator-excluded') return finalizeMutationResponse(response, { error: AUTH_MESSAGES.deletionExcluded }, 403)
    if (result.status === 'expired') return finalizeMutationResponse(response, { error: AUTH_MESSAGES.deletionExpired }, 403)
    // The database has already revoked every device, including this namespace.
    // A fresh empty selector also makes any delayed browser cookie writer inert.
    clearRecoveryCookie(response)
    await advanceStudentSessionGeneration(response)
    return finalizeMutationResponse(response, { next: ACCOUNT_DELETION_SCHEDULED_PATH })
  } catch (error) {
    return finalizeMutationResponse(response, { error: error instanceof AuthRequestError
      ? safeAuthMessage(error.message) : AUTH_MESSAGES.unavailable }, error instanceof AuthRequestError ? error.status : 503)
  }
}
