// lib/supabase/proxy.ts — Refresh student cookies without changing authorization decisions.
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import type { NextRequest } from 'next/server'

/** Return the same response carrying cookie writes and all SSR cache-safety headers.
 * Claims are refresh plumbing only; callers authenticate through getStudentSessionUser.
 */
export async function refreshStudentSession(request: NextRequest): Promise<NextResponse> {
  if (!isStudentAuthEnabled() || /^\/(admin|api\/admin)(\/|$)/.test(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('cookie', request.cookies.toString())
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  try {
    const { url, key } = getSupabaseConfig()
    const client = createServerClient(url, key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items, headers) {
        for (const { name, value, options } of items) {
          request.cookies.set(name, value)
          response.cookies.set(name, value, getStudentCookieOptions(options))
        }
        // Keep the downstream request coherent without replacing the cookie-bearing response.
        response.headers.set('x-middleware-request-cookie', request.cookies.toString())
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
      },
    } })
    await client.auth.getClaims()
  } catch {
    // Matched pages remain renderable; protected endpoints authenticate independently.
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}
