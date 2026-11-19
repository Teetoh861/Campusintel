import 'server-only'
import { NextResponse } from 'next/server'
import { AUTH_MESSAGES } from './constants'
import { authError } from './response'
import { authUnavailableBody, runAuthDiagnostic } from './unavailable'
import { getStudentCookieOptions } from './cookies'

/** Own diagnostics and invalid-cookie cleanup on the exact response the route returns. */
export function withAuthDiagnostics(route: string, operation: () => Promise<Response>): Promise<NextResponse> {
  return runAuthDiagnostic(route, async diagnostic => {
    let response: Response
    try { response = await operation() } catch (error) { response = authError(error, route) }
    let body: unknown
    if (response.status === 503 || diagnostic.reported) {
      try { body = await response.clone().json() } catch { /* Unreadable failures use the safe fallback below. */ }
    }
    const switchedOff = body && typeof body === 'object' && 'error' in body && body.error === AUTH_MESSAGES.comingSoon
    // Also cover direct/unanticipated 503s without trusting or logging their body.
    if (response.status === 503 && !diagnostic.reported && !switchedOff) {
      body = authUnavailableBody({ error: AUTH_MESSAGES.unavailable }, 503, { route })
      response = NextResponse.json(body,
        { status: 503, headers: response.headers })
    }
    if (diagnostic.clearCookies.size) {
      const writable = response instanceof NextResponse ? response : new NextResponse(response.body,
        { status: response.status, headers: response.headers })
      for (const name of diagnostic.clearCookies) {
        writable.cookies.set(name, '', getStudentCookieOptions({ maxAge: 0, expires: new Date(0) }))
      }
      response = writable
    }
    const final = response instanceof NextResponse ? response : new NextResponse(response.body,
      { status: response.status, headers: response.headers })
    if (diagnostic.reported && body && typeof body === 'object' && 'reference' in body && body.reference === diagnostic.reference) {
      final.headers.set('X-CampusIntell-Auth-Reference', diagnostic.reference)
    } else final.headers.delete('X-CampusIntell-Auth-Reference')
    return final
  })
}
