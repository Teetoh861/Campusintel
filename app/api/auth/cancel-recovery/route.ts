// app/api/auth/cancel-recovery/route.ts — Same-origin cancellation of recovery-only authorization.
import { readAuthRequest } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { emailRequestSchema } from '@/lib/auth/schemas'
import { clearRecoveryCookie, discardRecoveryGrantForFlow } from '@/lib/auth/recovery-grant'

/** Destroy the grant before the UI starts a different recovery flow. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, emailRequestSchema)
    const discarded = await discardRecoveryGrantForFlow(body.email)
    const response = authJson({ success: true })
    if (discarded) clearRecoveryCookie(response)
    return response
  } catch (error) { return authError(error) }
}
