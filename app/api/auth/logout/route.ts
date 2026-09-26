// app/api/auth/logout/route.ts — Same-origin current-session logout only.
import { clearRecoveryCookie, discardRecoveryGrant } from '@/lib/auth/recovery-grant'
import { readAuthRequest } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { logoutSchema } from '@/lib/auth/schemas'
import { createClient } from '@/lib/supabase/server'

/** Revoke the current session without signing other devices out. */
export async function POST(request: Request) {
  try {
    await readAuthRequest(request, logoutSchema)
    await discardRecoveryGrant()
    const response = authJson({ success: true })
    clearRecoveryCookie(response)
    const client = await createClient(response)
    const { error: lookupError } = await client.auth.getClaims()
    if (lookupError) throw new Error('Session lookup failed')
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Sign out failed')
    return response
  } catch (error) { return authError(error) }
}
