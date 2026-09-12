// app/api/auth/login/route.ts — Server authentication with HttpOnly session transfer.
import { readAuthRequest, getRequesterAddress, AuthRequestError } from '@/lib/auth/request'
import { authJson, authError } from '@/lib/auth/response'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { getAuthGateway } from '@/lib/supabase/auth-gateway'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { createClient } from '@/lib/supabase/server'

/** Verify credentials server-side; serialize only a validated destination. */
export async function POST(request: Request) {
  try {
    const body = await readAuthRequest(request, loginSchema)
    const address = getRequesterAddress(request)
    await consumeAuthLimit('LOGIN', body.email, address)
    const { data, error } = await getAuthGateway(address).signInWithPassword({ email: body.email, password: body.password })
    if (error || !data.session) throw new AuthRequestError(400, AUTH_MESSAGES.credentials)
    const response = authJson({ next: getSafeReturnPath(body.next) })
    const client = await createClient(response)
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    })
    if (sessionError) throw new Error('Session transfer failed')
    return response
  } catch (error) { return authError(error) }
}
