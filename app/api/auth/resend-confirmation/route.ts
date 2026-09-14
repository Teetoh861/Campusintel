// app/api/auth/resend-confirmation/route.ts — Enumeration-safe email initiation.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { checkEmailInitiation } from '@/lib/auth/errors'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { emailRequestSchema } from '@/lib/auth/schemas'

/** Validate and throttle email initiation without revealing provider/account state. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, emailRequestSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const address = getRequesterAddress(request)
    await consumeAuthLimit('RESEND_CONFIRMATION', body.email, address)
    const gateway = getAuthGateway(address)
    // Recipient-dependent outcomes share the same outward state.
    const { error } = await gateway.resend({ type: 'signup', email: body.email })
    checkEmailInitiation(error)
    return authJson({ message: AUTH_MESSAGES.email })
  } catch (error) { return authError(error) }
}
