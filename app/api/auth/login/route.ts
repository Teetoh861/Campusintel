import { authUnavailable, authUnavailableReason } from '@/lib/auth/unavailable'
import { withAuthDiagnostics } from '@/lib/auth/route-boundary'
// app/api/auth/login/route.ts — Server authentication with HttpOnly session transfer.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_OTP_TYPES, EMAIL_CONFIRMATION_REQUIRED } from '@/lib/auth/constants'
import { mapAuthFailure } from '@/lib/auth/errors'
import { initiateAuthEmail } from '@/lib/auth/email-initiation'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { createFreshStudentSessionClient } from '@/lib/supabase/server'
import { requireVerifiedSession } from '@/lib/auth/verified-session'
import { endOtherStudentSessions } from '@/lib/auth/one-device'
import { checkResendAcknowledgment } from '@/lib/auth/signup-result'
import { recordSuccessfulLogin } from '@/lib/analytics/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { finalizeMutationResponse } from '@/lib/auth/mutation-response'
import type { NextResponse } from 'next/server'

/** Verify credentials server-side; serialize only a validated destination. */
export async function POST(request: Request): Promise<NextResponse> {
  return withAuthDiagnostics('/api/auth/login', async () => {
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
          const gateway = getAuthGateway(address)
          const resendFailure = await initiateAuthEmail('resend',
            () => gateway.resend({ type: AUTH_OTP_TYPES.confirmation, email: body.email }), checkResendAcknowledgment)
          if (resendFailure) return authJson({ error: resendFailure.error }, resendFailure.status, { route: '/api/auth/login' })
          return authJson({ code: failure.code })
        }
        return authJson({ error: failure.error }, failure.status, { route: '/api/auth/login', reason: authUnavailableReason(error, 'provider') })
      }
      const session = requireVerifiedSession(data, body.email)
      const response = authJson({ next: getSafeReturnPath(body.next) })
      const client = await createFreshStudentSessionClient(response)
      const { data: transferred, error: sessionError } = await client.auth.setSession({
        access_token: session.access_token, refresh_token: session.refresh_token,
      })
      if (sessionError) throw authUnavailable(sessionError, 'identity')
      if (requireVerifiedSession(transferred, body.email).user.id !== session.user.id) throw authUnavailable(null, 'identity')
      await endOtherStudentSessions(client, session.access_token)
      // The Auth trigger denies a login already expired at session creation with a
      // generic provider failure. This read still catches expiry during transfer;
      // never bypass that trigger or look up an unauthenticated account for copy.
      const lifecycle = await readAccountLifecycle(client)
      if (lifecycle.status === 'signed-out' || lifecycle.status === 'expired') {
        await client.auth.signOut({ scope: 'local' })
        return authJson({ error: lifecycle.status === 'expired'
          ? AUTH_MESSAGES.deletionExpired : AUTH_MESSAGES.sessionChanged }, lifecycle.status === 'expired' ? 403 : 409)
      }
      await recordSuccessfulLogin()
      return finalizeMutationResponse(response, { next: lifecycle.status === 'scheduled'
        ? ACCOUNT_DELETION_PATH : getSafeReturnPath(body.next) })
    } catch (error) { return authError(error, '/api/auth/login') }
  })
}
