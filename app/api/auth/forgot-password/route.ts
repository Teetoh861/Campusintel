// app/api/auth/forgot-password/route.ts — Enumeration-safe email initiation.
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { emailRequestSchema } from '@/lib/auth/schemas'

/** Validate and throttle email initiation without revealing provider/account state. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, emailRequestSchema)
    const address = getRequesterAddress(request)
    await consumeAuthLimit('PASSWORD_RESET_REQUEST', body.email, address)
    const gateway = getAuthGateway(address)
    // All provider outcomes share the same outward state, including existing accounts.
    await gateway.resetPasswordForEmail(body.email)
    return authJson({ message: AUTH_MESSAGES.recovery })
  } catch (error) { return authError(error) }
}
