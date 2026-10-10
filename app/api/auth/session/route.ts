// app/api/auth/session/route.ts — Live private Auth status and optional page continuity.
import { AUTH_CONTINUITY_HEADER, AUTH_LOGOUT_CONTEXT_HEADER, AUTH_MESSAGES } from '@/lib/auth/constants'
import { issueAccountContinuityToken, matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { authJson } from '@/lib/auth/response'
import { getStudentSessionContext, getStudentSessionUser } from '@/lib/auth/student-state'

/** Return live Auth status; an optional comparison never authorizes profile access. */
export async function GET(request: Request) {
  const token = request.headers.get(AUTH_CONTINUITY_HEADER)
  const logoutContext = token === null && request.headers.get(AUTH_LOGOUT_CONTEXT_HEADER) === 'true'
  if (!isStudentAuthEnabled()) return authJson(token === null
    ? { enabled: false, signedIn: false }
    : { enabled: false, signedIn: false, sameAccount: false })
  const response = authJson({ enabled: true, signedIn: false })
  try {
    let status: { enabled: true; signedIn: boolean; sameAccount?: boolean; continuityToken?: string }
    if (logoutContext) {
      // Establish chrome's rendered logout identity, never rebind a submitted action on click.
      const context = await getStudentSessionContext(response)
      status = { enabled: true, signedIn: context !== null,
        ...(context ? { continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId) } : {}) }
    } else if (token === null) {
      status = { enabled: true, signedIn: (await getStudentSessionUser(response)) !== null }
    } else {
      const context = await getStudentSessionContext(response)
      status = { enabled: true, signedIn: context !== null,
        sameAccount: context !== null && matchesAccountContinuityToken(token, context.user.id, context.sessionId) }
    }
    // Preserve refresh headers/cookies while replacing only the minimal JSON body.
    return new Response(JSON.stringify(status), {
      status: response.status, headers: response.headers,
    })
  } catch {
    // Preserve any refresh/clearing cookies, but never report an infrastructure failure as sign-out.
    return new Response(JSON.stringify({ error: AUTH_MESSAGES.unavailable }), {
      status: 503, headers: response.headers,
    })
  }
}
