// lib/supabase/recovery-auth.ts — Narrow privileged Auth operations for verified password recovery.
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'
import { isIP } from 'node:net'
import { authDeadline, authFetch } from '@/lib/auth/deadline'
import { authUnavailable } from '@/lib/auth/unavailable'

/** Expose only temporary-session revocation and password replacement, never table access. */
export function getRecoveryAuthGateway(address: string) {
  const { url } = getSupabaseConfig()
  const client = createClient(url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authFetch, headers: isIP(address) ? { 'sb-forwarded-for': address } : {} },
  })
  return {
    async revokeTemporarySession(accessToken: string) {
      const { error } = await authDeadline(() => client.auth.admin.signOut(accessToken, 'local'), 'provider')
      if (error) throw authUnavailable(error, 'provider')
    },
    async replacePasswordAndRevokeSessions(userId: string, password: string) {
      // GoTrue adminUserUpdate calls UpdatePassword(tx, nil): password update and Logout(userId)
      // share one transaction. No user JWT is needed for the global refresh-session revocation.
      // https://github.com/supabase/auth/blob/v2.192.0/internal/api/admin.go#L195
      const { data, error } = await authDeadline(() => client.auth.admin.updateUserById(userId, { password }), 'provider')
      if (!error && data.user?.id !== userId) throw authUnavailable(null, 'identity')
      return { error }
    },
  }
}
