// lib/supabase/proxy.ts — Refresh account cookies without changing authorization decisions.
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import { CHROME_STATE_HEADER } from '@/lib/auth/chrome-state'
import { canonicalizeStudentSessionCookieHeaderForDownstream,
  resolveStudentSessionNamespaceFromCookieHeader } from '@/lib/auth/session-generation'
import type { ChromeState } from '@/lib/auth/chrome-state'
import type { CookieOptions } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'

/** Return the same response carrying cookie writes and all SSR cache-safety headers.
 * Claims are refresh plumbing only; callers authenticate through getStudentSessionUser.
 * Page GETs also hand the first render the live lifecycle answer, as presentation state only.
 */
export async function refreshStudentSession(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(CHROME_STATE_HEADER)
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
    if (error || typeof data?.claims?.sub !== 'string' || !data.claims.sub) chrome = 'signed-out'
    else if (request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/')) {
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
  const response = restricted
    ? NextResponse.redirect(new URL(ACCOUNT_DELETION_PATH, request.url))
    : NextResponse.next({ request: { headers: requestHeaders } })
  for (const { name, value, options } of writes) response.cookies.set(name, value, getStudentCookieOptions(options))
  refreshHeaders.forEach((value, name) => response.headers.set(name, value))
  if (restricted || (failed && !response.headers.has('Cache-Control'))) {
    response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}
