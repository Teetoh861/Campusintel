// app/api/auth/register/route.ts — Enumeration-safe email initiation.
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { registerSchema } from '@/lib/auth/schemas'

/** Validate and throttle email initiation without revealing provider/account state. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, registerSchema)
    const address = getRequesterAddress(request)
    await consumeAuthLimit('REGISTER', body.email, address)
    const gateway = getAuthGateway(address)
    // All provider outcomes share the same outward state, including existing accounts.
    await gateway.signUp({ email: body.email, password: body.password })
    return authJson({ message: AUTH_MESSAGES.email })
  } catch (error) { return authError(error) }
}
