// lib/supabase/client.ts — Supabase browser client factory.
//
// Creates the Supabase client used in Client Components. It is configured
// with ONLY the two public values (NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Both are intentionally shipped to the
// browser: the anon key identifies the project and carries no privileged
// bypass of its own. Every read and write is authorized in Postgres by Row
// Level Security against the signed-in user's JWT, never by this key.
//
// There is deliberately no service-role key here, no custom token storage
// and no localStorage/sessionStorage auth. @supabase/ssr stores the session
// in cookies so the browser and the server observe the same session.
//
// Phase A1 foundation module: nothing imports this yet. A2 wires it into the
// registration/login UI. Before that happens, the Supabase project origin
// must be added to `connect-src` in next.config.mjs — the current CSP would
// otherwise block every request this client makes.
import { createBrowserClient } from '@supabase/ssr'

// The env vars are referenced as full literal `process.env.X` expressions
// rather than through a lookup helper: Next.js inlines NEXT_PUBLIC_ values
// into the client bundle by static analysis, and a dynamic `process.env[key]`
// read would silently arrive as undefined in the browser.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Validated at call time, not module scope, so merely importing this module
  // cannot break a build or render when the env is not configured.
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.'
    )
  }

  return createBrowserClient(url, anonKey)
}
