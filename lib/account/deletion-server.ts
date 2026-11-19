import 'server-only'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { getRecoveryAuthGateway } from '@/lib/supabase/recovery-auth'
import { requireVerifiedSession } from '@/lib/auth/verified-session'
import { AuthRequestError } from '@/lib/auth/request'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import type { LiveMutationContext } from '@/lib/auth/mutation-context'
import { authDeadline, authFetch, bindStudentAuthDeadlines } from '@/lib/auth/deadline'
import { authUnavailable } from '@/lib/auth/unavailable'

const scheduled = z.object({ status: z.literal('scheduled'), deadline: z.string().datetime({ offset: true }), requestId: z.string().uuid() }).strict()
const scheduleResult = z.union([scheduled, z.object({ status: z.enum(['operator-excluded', 'expired']) }).strict()])

/** Verify the current password on a cookie-free Auth client, then schedule atomically.
 * Only this module holds the service capability. No request body identity is accepted.
 */
export async function scheduleStudentDeletion(context: LiveMutationContext, password: string, address: string) {
  const email = context.user.email
  if (!email) throw new Error('Account identity unavailable')
  const { data, error } = await getAuthGateway(address).signInWithPassword({ email, password })
  if (error) {
    if (error.code === 'invalid_credentials' || error.code === 'user_banned') return { status: 'password-invalid' } as const
    if (error.code === 'over_request_rate_limit') throw new AuthRequestError(429, AUTH_MESSAGES.limited)
    throw authUnavailable(error, 'provider', 'Password verification unavailable')
  }
  // Capture only the revocation capability before validating the provider envelope.
  // An invalid identity/session response can still have created an Auth session.
  const proofAccessToken = data?.session?.access_token
  let proofRevoked = false
  // Revoke the proof session on every outcome, including an unexpected RPC failure.
  try {
    const session = requireVerifiedSession(data, email.toLowerCase())
    if (session.user.id !== context.user.id) throw authUnavailable(null, 'identity', 'Password identity mismatch')
    const { url, key } = getSupabaseConfig()
    const proofClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: authFetch, headers: { Authorization: `Bearer ${session.access_token}` } },
    })
    bindStudentAuthDeadlines(proofClient.auth)
    const { data: verified, error: claimError } = await proofClient.auth.getClaims(session.access_token)
    const proofId = z.string().uuid().parse(verified?.claims.session_id)
    if (claimError || verified?.claims.sub !== context.user.id) throw authUnavailable(claimError, 'identity', 'Password verification failed')
    const service = createClient(url, getAuthSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: authFetch },
    })
    const result = await authDeadline(() => service.rpc('schedule_student_deletion', {
      p_session_id: context.sessionId, p_verified_session_id: proofId,
    }), 'identity')
    if (result.error) throw authUnavailable(result.error, 'identity', 'Deletion scheduling failed')
    const scheduledResult = scheduleResult.parse(result.data)
    proofRevoked = scheduledResult.status === 'scheduled'
    return scheduledResult
  } finally {
    // A successful schedule revoked every session in its transaction. Local
    // Auth rejects revoking that missing session again; clean up only otherwise.
    if (!proofRevoked && typeof proofAccessToken === 'string' && proofAccessToken) {
      try { await getRecoveryAuthGateway(address).revokeTemporarySession(proofAccessToken) }
      catch {
        // Cleanup is secondary: keep the validated RPC result or original failure.
        // In particular, an ambiguous RPC response may already have revoked it.
        console.error('Account deletion proof-session cleanup failed')
      }
    }
  }
}
