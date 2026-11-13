// lib/supabase/proxy.ts — Refresh account cookies without changing authorization decisions, and send a signed-in
// student from the public landing page to their home.
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import { CHROME_STATE_HEADER, STUDENT_RENDER_PATH_HEADER } from '@/lib/auth/chrome-state'
import { canonicalizeStudentSessionCookieHeaderForDownstream,
  resolveStudentSessionNamespaceFromCookieHeader } from '@/lib/auth/session-generation'
import type { ChromeState } from '@/lib/auth/chrome-state'
import type { CookieOptions } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'

// The landing page is built once for every visitor and never reads the session, so its signed-in redirect lives here.
const LANDING_PATH = '/'

/** Return the same response carrying cookie writes and all SSR cache-safety headers.
 * Claims are refresh plumbing only; callers authenticate through getStudentSessionUser.
 * Keep lifecycle routing here: client navigations can reuse the root layout without rendering it again.
 * The landing page redirects on the same live answer the chrome uses: an active account with a session the database
 * still holds. A session ended elsewhere, an unclear answer or a failed check all see the landing page.
 */
export async function refreshStudentSession(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(CHROME_STATE_HEADER)
  requestHeaders.delete(STUDENT_RENDER_PATH_HEADER)
  const renderPage = request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/')
  if (renderPage) requestHeaders.set(STUDENT_RENDER_PATH_HEADER, request.nextUrl.pathname)
  if (!isStudentAuthEnabled()) {
    requestHeaders.set(CHROME_STATE_HEADER, 'signed-out' satisfies ChromeState)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }
  const rawCookieHeader = request.headers.get('cookie')
  const namespace = resolveStudentSessionNamespaceFromCookieHeader(rawCookieHeader)
  const downstreamCookieHeader = canonicalizeStudentSessionCookieHeaderForDownstream(rawCookieHeader, namespace)
  if (namespace.mode === 'invalid' && downstreamCookieHeader !== null) requestHeaders.set('cookie', downstreamCookieHeader)
  // Next fixes downstream request headers when the response is created, so writes wait for the live answer.
  const writes: { name: string; value: string; options: CookieOptions }[] = []
  const refreshHeaders = new Headers()
  let chrome: ChromeState = 'unknown'
  let restricted = false
  let failed = false
  try {
    const { url, key } = getSupabaseConfig()
    const client = createServerClient(url, key, {
      ...(namespace.storageName ? { cookieOptions: { name: namespace.storageName } } : {}),
      cookies: {
        getAll: () => namespace.mode === 'invalid' ? [] : request.cookies.getAll(),
        setAll(items, headers) {
          for (const { name, value, options } of items) {
            request.cookies.set(name, value)
            writes.push({ name, value, options })
          }
          Object.entries(headers).forEach(([name, value]) => refreshHeaders.set(name, value))
        },
      },
    })
    const { data, error } = await client.auth.getClaims()
    // Only the SDK's explicit no-session answer is signed-out; unclear answers stay neutral.
    if (error !== null) failed = true
    else if (data === null) chrome = 'signed-out'
    else if (typeof data?.claims?.sub !== 'string' || !data.claims.sub) failed = true
    else if (renderPage) {
      const lifecycle = await readAccountLifecycle(client)
      chrome = lifecycle.status === 'signed-out' ? 'signed-out' : 'signed-in'
      restricted = (lifecycle.status === 'scheduled' || lifecycle.status === 'expired') &&
        request.nextUrl.pathname !== ACCOUNT_DELETION_PATH
    }
  } catch {
    // Matched pages remain renderable; protected endpoints authenticate independently.
    failed = true
  }
  // Keep the downstream request coherent with the cookies this response writes.
  if (writes.length) {
    requestHeaders.set('cookie', namespace.mode === 'invalid' ? downstreamCookieHeader ?? '' : request.cookies.toString())
  }
  requestHeaders.set(CHROME_STATE_HEADER, chrome)
  // A restricted account goes to its deletion page first, from the landing page too.
  const home = !restricted && chrome === 'signed-in' && request.nextUrl.pathname === LANDING_PATH
  const redirectPath = restricted ? ACCOUNT_DELETION_PATH : home ? STUDENT_HOME_PATH : null
  const response = redirectPath === null
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.redirect(new URL(redirectPath, request.url))
  for (const { name, value, options } of writes) response.cookies.set(name, value, getStudentCookieOptions(options))
  refreshHeaders.forEach((value, name) => response.headers.set(name, value))
  // A redirect is one student's answer; it must never be stored and replayed to a signed-out visitor.
  if (redirectPath !== null || (failed && !response.headers.has('Cache-Control'))) {
    response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}
