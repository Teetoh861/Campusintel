// lib/supabase/proxy.ts — Refresh account cookies without changing authorization decisions.
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import { canonicalizeStudentSessionCookieHeaderForDownstream,
  resolveStudentSessionNamespaceFromCookieHeader } from '@/lib/auth/session-generation'
import type { NextRequest } from 'next/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'

/** Return the same response carrying cookie writes and all SSR cache-safety headers.
 * Claims are refresh plumbing only; callers authenticate through getStudentSessionUser.
 */
export async function refreshStudentSession(request: NextRequest): Promise<NextResponse> {
  if (!isStudentAuthEnabled()) {
    return NextResponse.next()
  }
  const requestHeaders = new Headers(request.headers)
  const rawCookieHeader = request.headers.get('cookie')
  const namespace = resolveStudentSessionNamespaceFromCookieHeader(rawCookieHeader)
  const downstreamCookieHeader = canonicalizeStudentSessionCookieHeaderForDownstream(rawCookieHeader, namespace)
  if (namespace.mode === 'invalid' && downstreamCookieHeader !== null) requestHeaders.set('cookie', downstreamCookieHeader)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  try {
    const { url, key } = getSupabaseConfig()
    const client = createServerClient(url, key, {
      ...(namespace.storageName ? { cookieOptions: { name: namespace.storageName } } : {}),
      cookies: {
        getAll: () => namespace.mode === 'invalid' ? [] : request.cookies.getAll(),
        setAll(items, headers) {
          for (const { name, value, options } of items) {
            request.cookies.set(name, value)
            response.cookies.set(name, value, getStudentCookieOptions(options))
          }
          // Keep the downstream request coherent without replacing the cookie-bearing response.
          response.headers.set('x-middleware-request-cookie', namespace.mode === 'invalid'
            ? downstreamCookieHeader ?? '' : request.cookies.toString())
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
        },
      },
    })
    const { data, error } = await client.auth.getClaims()
    if (!error && typeof data?.claims?.sub === 'string' && data.claims.sub &&
        request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/') &&
        request.nextUrl.pathname !== ACCOUNT_DELETION_PATH) {
      const lifecycle = await readAccountLifecycle(client)
      if (lifecycle.status === 'scheduled' || lifecycle.status === 'expired') {
        const target = NextResponse.redirect(new URL(ACCOUNT_DELETION_PATH, request.url))
        response.cookies.getAll().forEach(cookie => target.cookies.set(cookie))
        target.headers.set('Cache-Control', 'private, no-store')
        return target
      }
    }
  } catch {
    // Matched pages remain renderable; protected endpoints authenticate independently.
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}
