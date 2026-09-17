// app/api/auth/session/route.ts — Minimal private auth status for the global navigation.
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { authJson } from '@/lib/auth/response'
import { createClient } from '@/lib/supabase/server'

/** Return booleans only; cookie refresh stays on the exact response returned. */
export async function GET() {
  if (!isStudentAuthEnabled()) return authJson({ enabled: false, signedIn: false })
  const response = authJson({ enabled: true, signedIn: false })
  try {
    const client = await createClient(response)
    const { data, error } = await client.auth.getClaims()
    if (error) throw new Error('Session lookup failed')
    if (data !== null && (typeof data?.claims?.sub !== 'string' || !data.claims.sub)) throw new Error('Session result invalid')
    // Preserve refresh headers/cookies while replacing only the minimal JSON body.
    return new Response(JSON.stringify({ enabled: true, signedIn: data !== null }), {
      status: response.status, headers: response.headers,
    })
  } catch {
    // Preserve any refresh/clearing cookies, but never report an infrastructure failure as sign-out.
    return new Response(JSON.stringify({ error: AUTH_MESSAGES.unavailable }), {
      status: 503, headers: response.headers,
    })
  }
}
