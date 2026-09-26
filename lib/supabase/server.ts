// lib/supabase/server.ts — Supabase server client factory.
//
// SERVER-ONLY. This module imports `cookies()` from next/headers and must
// never be imported into a Client Component; doing so is a build error in the
// App Router. Use it from Server Components, Route Handlers and Server
// Actions only. (lib/supabase/client.ts is the browser counterpart.)
//
// Like the browser client it uses only the two public values and holds no
// service-role key: authorization is decided by Row Level Security against
// the signed-in user's JWT.
//
// A new client must be created per request — never module-scoped or cached
// across requests — because it is bound to that request's cookie store.
//
// Phase A1 foundation module: nothing imports this yet, and importing it into
// a public route would make that route dynamic. A2 adds the session-refresh
// integration in proxy.ts that makes cookie writes durable (see setAll).
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  // Next.js 16: cookies() is async and must be awaited.
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.'
    )
  }

  return createServerClient(url, anonKey, {
    // The supported getAll/setAll cookie interface. The older per-cookie
    // get/set/remove shape is deprecated and must not be used.
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          // `options` is forwarded exactly as Supabase supplies it so the
          // session cookie keeps its intended name, path, expiry, sameSite
          // and httpOnly flags. Never substitute hand-written options here.
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Documented SSR behaviour: the cookie store is read-only inside a
          // Server Component, so a token refresh during render cannot persist
          // and throws here. Safe to ignore when a proxy/middleware refreshes
          // the session and writes the rotated cookies to the response — that
          // integration is A2 work. Until A2 lands, a session refreshed during
          // a Server Component render simply is not persisted.
        }
      },
    },
  })
}
