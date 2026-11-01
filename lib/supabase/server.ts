// lib/supabase/server.ts — Request-scoped publishable-key HttpOnly session client.
import 'server-only'
import { cache } from 'react'
import { registerStudentRenderClient } from '@/lib/auth/render-session'
import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { getSupabaseConfig } from '@/lib/auth/config'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import { advanceStudentSessionGeneration, resolveStudentSessionNamespace,
  resolveStudentSessionNamespaceFromCookieHeader } from '@/lib/auth/session-generation'
import type { NextResponse } from 'next/server'

/** Create a user-scoped client. Route handlers supply the exact response they return.
 * Server Components tolerate read-only cookies; the proxy persists refreshes before render.
 */
async function clientForRequest(response?: NextResponse, freshGeneration?: string) {
  // Next's render cookie merge can normalize the shared header; capture authority first.
  const rawCookieHeader = freshGeneration === undefined ? (await headers()).get('cookie') : null
  const namespace = freshGeneration === undefined
    ? resolveStudentSessionNamespaceFromCookieHeader(rawCookieHeader)
    : resolveStudentSessionNamespace(freshGeneration)
  const store = await cookies()
  const jar = new Map(store.getAll().map(cookie => [cookie.name, cookie.value]))
  const { url, key } = getSupabaseConfig()
  return createServerClient(url, key, {
    ...(namespace.storageName ? { cookieOptions: { name: namespace.storageName } } : {}),
    cookies: {
      getAll: () => namespace.mode === 'invalid' ? [] : Array.from(jar, ([name, value]) => ({ name, value })),
      setAll(items, headers) {
        for (const { name, value, options } of items) {
          jar.set(name, value)
          const hardened = getStudentCookieOptions(options)
          if (response) response.cookies.set(name, value, hardened)
          else {
            try { store.set(name, value, hardened) } catch { /* Read-only Server Component. */ }
          }
        }
        if (response) Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
      },
    },
  })
}

export type StudentClient = Awaited<ReturnType<typeof clientForRequest>>

// cache() is intentionally a no-op outside RSC. Route-handler clients must retain fresh lifecycle reads.
const renderScope = cache(() => ({}))
const renderClientForRequest = cache(async () => {
  const client = await clientForRequest()
  return renderScope() === renderScope() ? registerStudentRenderClient(client) : client
})

/** Share the cookie-bound render client; response-bearing mutation clients remain fresh and writable. */
export async function createClient(response?: NextResponse) {
  return response === undefined ? renderClientForRequest() : clientForRequest(response)
}

/** Transfer a verified session into a fresh namespace on the same response as its selector. */
export async function createFreshStudentSessionClient(response: NextResponse) {
  return clientForRequest(response, await advanceStudentSessionGeneration(response))
}
