// app/api/auth/cancel-recovery/route.ts — Same-origin cancellation of recovery-only authorization.
import { readAuthRequest } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { logoutSchema } from '@/lib/auth/schemas'
import { clearRecoveryCookie, discardRecoveryGrant } from '@/lib/auth/recovery-grant'

/** Destroy the grant before the UI starts a different recovery flow. */
export async function POST(request: Request) {
  try {
    await readAuthRequest(request, logoutSchema)
    await discardRecoveryGrant()
    const response = authJson({ success: true })
    clearRecoveryCookie(response)
    return response
  } catch (error) { return authError(error) }
}
