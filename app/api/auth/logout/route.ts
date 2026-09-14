// app/api/auth/logout/route.ts — Same-origin current-session logout only.
import { readAuthRequest } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { logoutSchema } from '@/lib/auth/schemas'
import { createClient } from '@/lib/supabase/server'

/** Revoke the current session without signing other devices out. */
export async function POST(request: Request) {
  try {
    await readAuthRequest(request, logoutSchema)
    const response = authJson({ success: true })
    const client = await createClient(response)
    await client.auth.getClaims()
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Sign out failed')
    return response
  } catch (error) { return authError(error) }
}
