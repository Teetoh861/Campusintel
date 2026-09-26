// lib/supabase/auth-gateway.ts — Auth-only server gateway for trusted IP forwarding.
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'

/** Expose only the five required Auth methods, never privileged application-data access.
 * Hosted forwarding requires an sb_secret key and the Supabase IP-forwarding setting.
 * Local fallback omits the header: "local" is a bucket identifier, not an IP address.
 */
export function getAuthGateway(address: string) {
  const { url } = getSupabaseConfig()
  const client = createClient(url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: address === 'local' ? {} : { 'sb-forwarded-for': address } },
  })
  return {
    signUp: client.auth.signUp.bind(client.auth),
    signInWithPassword: client.auth.signInWithPassword.bind(client.auth),
    resend: client.auth.resend.bind(client.auth),
    resetPasswordForEmail: client.auth.resetPasswordForEmail.bind(client.auth),
    verifyOtp: client.auth.verifyOtp.bind(client.auth),
  }
}
