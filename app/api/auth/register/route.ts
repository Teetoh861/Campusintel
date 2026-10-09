// app/api/auth/register/route.ts — Enumeration-safe email initiation.
import { rejectExistingStudent } from '@/lib/auth/student-state'
import { readAuthRequest, getRequesterAddress } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { initiateAuthEmail } from '@/lib/auth/email-initiation'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { checkSignupAcknowledgment } from '@/lib/auth/signup-result'
import { registerSchema } from '@/lib/auth/schemas'
import type { NextResponse } from 'next/server'

/** Validate and throttle email initiation without revealing provider/account state. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await readAuthRequest(request, registerSchema)
    const existing = await rejectExistingStudent()
    if (existing) return existing
    const address = getRequesterAddress(request)
    await consumeAuthLimit('REGISTER', body.email, address)
    const gateway = getAuthGateway(address)
    // Do not branch on provider-obfuscated user fields; only the envelope and absence of a session are authoritative.
    const failure = await initiateAuthEmail('register',
      () => gateway.signUp({ email: body.email, password: body.password }), checkSignupAcknowledgment)
    if (failure) return authJson({ error: failure.error }, failure.status)
    return authJson({ message: AUTH_MESSAGES.email })
  } catch (error) { return authError(error) }
}
