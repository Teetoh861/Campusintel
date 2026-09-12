// lib/supabase/server.ts — Request-scoped publishable-key HttpOnly session client.
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseConfig } from '@/lib/auth/config'
import { getStudentCookieOptions } from '@/lib/auth/cookies'
import type { NextResponse } from 'next/server'

/** Create a user-scoped client. Route handlers supply the exact response they return.
 * Server Components tolerate read-only cookies; the proxy persists refreshes before render.
 */
export async function createClient(response?: NextResponse) {
  const store = await cookies()
  const jar = new Map(store.getAll().map(cookie => [cookie.name, cookie.value]))
  const { url, key } = getSupabaseConfig()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
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
