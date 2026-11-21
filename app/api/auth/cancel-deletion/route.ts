import { withAuthDiagnostics } from '@/lib/auth/route-boundary'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER, AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { cancelDeletionSchema } from '@/lib/auth/schemas'
import { readAuthRequest, AuthRequestError } from '@/lib/auth/request'
import { authJson } from '@/lib/auth/response'
import { authUnavailableReason } from '@/lib/auth/unavailable'
import { safeAuthMessage } from '@/lib/auth/errors'
import { getAuthenticatedMutationContext } from '@/lib/auth/mutation-context'
import { finalizeMutationResponse } from '@/lib/auth/mutation-response'
import { authDeadline } from '@/lib/auth/deadline'
import { authUnavailable } from '@/lib/auth/unavailable'

const cancellation = z.object({ status: z.enum(['active', 'expired', 'conflict']) }).strict()

/** The only student restoration mutation; login and lifecycle reads never call it. */
export async function POST(request: Request) {
  return withAuthDiagnostics('/api/auth/cancel-deletion', async () => {
    const response = authJson({})
    try {
      const body = await readAuthRequest(request, cancelDeletionSchema)
      const mutation = await getAuthenticatedMutationContext(response, request.headers.get(AUTH_CONTINUITY_HEADER), { allowRestricted: true })
      if (mutation.status === 'session-changed') return finalizeMutationResponse(response, { status: 'session-changed' }, 409)
      if (mutation.status !== 'ready') return finalizeMutationResponse(response,
        { error: AUTH_MESSAGES.unavailable }, mutation.status === 'signed-out' ? 401 : 503,
        { route: '/api/auth/cancel-deletion', reason: mutation.status === 'unavailable' ? mutation.reason : { step: 'unexpected', code: null } })
      const { data, error } = await authDeadline(() => mutation.context.client.rpc('cancel_student_deletion', { p_request_id: body.requestId }), 'identity')
      if (error) throw authUnavailable(error, 'identity')
      const result = cancellation.parse(data)
      if (result.status === 'expired') return finalizeMutationResponse(response, { error: AUTH_MESSAGES.deletionExpired }, 403)
      if (result.status === 'conflict') return finalizeMutationResponse(response, { status: 'session-changed' }, 409)
      return finalizeMutationResponse(response, { next: STUDENT_HOME_PATH })
    } catch (error) {
      return finalizeMutationResponse(response, { error: error instanceof AuthRequestError
        ? safeAuthMessage(error.message) : AUTH_MESSAGES.unavailable }, error instanceof AuthRequestError ? error.status : 503,
        { route: '/api/auth/cancel-deletion', reason: authUnavailableReason(error) })
    }
  })
}
