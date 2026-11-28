// lib/supabase/auth-gateway.ts — Auth-only server gateway for trusted IP forwarding.
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'
import { isIP } from 'node:net'
import { authDeadline, authFetch } from '@/lib/auth/deadline'

/** Expose only the five required Auth methods, never privileged application-data access.
 * Hosted forwarding requires an sb_secret key and the Supabase IP-forwarding setting.
 * Local fallback omits the header: "local" is a bucket identifier, not an IP address.
 */
export function getAuthGateway(address: string) {
  const { url } = getSupabaseConfig()
  const client = createClient(url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authFetch, headers: isIP(address) ? { 'sb-forwarded-for': address } : {} },
  })
  return {
    signUp: (...args: Parameters<typeof client.auth.signUp>) => authDeadline(() => client.auth.signUp(...args), 'provider'),
    signInWithPassword: (...args: Parameters<typeof client.auth.signInWithPassword>) => authDeadline(() => client.auth.signInWithPassword(...args), 'provider'),
    resend: (...args: Parameters<typeof client.auth.resend>) => authDeadline(() => client.auth.resend(...args), 'provider'),
    resetPasswordForEmail: (...args: Parameters<typeof client.auth.resetPasswordForEmail>) => authDeadline(() => client.auth.resetPasswordForEmail(...args), 'provider'),
    verifyOtp: (...args: Parameters<typeof client.auth.verifyOtp>) => authDeadline(() => client.auth.verifyOtp(...args), 'provider'),
  }
}
