// app/api/auth/forgot-password/route.ts — Enumeration-safe email initiation.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { clearRecoveryCookie, discardRecoveryGrant } from '@/lib/auth/recovery-grant'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { initiateAuthEmail } from '@/lib/auth/email-initiation'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { checkRecoveryAcknowledgment } from '@/lib/auth/signup-result'
import { emailRequestSchema } from '@/lib/auth/schemas'
import type { NextResponse } from 'next/server'

/** Validate and throttle email initiation without revealing provider/account state. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await readAuthRequest(request, emailRequestSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    await discardRecoveryGrant()
    const address = getRequesterAddress(request)
    await consumeAuthLimit('PASSWORD_RESET_REQUEST', body.email, address)
    const gateway = getAuthGateway(address)
    const failure = await initiateAuthEmail('recovery',
      () => gateway.resetPasswordForEmail(body.email), checkRecoveryAcknowledgment)
    if (failure) return authJson({ error: failure.error }, failure.status)
    const response = authJson({ message: AUTH_MESSAGES.recovery })
    clearRecoveryCookie(response)
    return response
  } catch (error) { return authError(error) }
}
