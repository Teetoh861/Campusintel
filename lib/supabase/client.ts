// lib/supabase/client.ts — Future anonymous browser-data client; never student authentication.
// It cannot read the HttpOnly student session and must not be used for student auth.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/** Create an anonymous data client without token persistence or URL session detection. */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured')
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
