// app/api/auth/session/route.ts — Minimal private auth status for the global navigation.
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
    // Preserve refresh headers/cookies while replacing only the minimal JSON body.
    return new Response(JSON.stringify({ enabled: true, signedIn: !error && !!data?.claims.sub }), {
      status: response.status, headers: response.headers,
    })
  } catch { return response }
}
