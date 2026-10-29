import 'server-only'
import type { createClient } from '@/lib/supabase/server'

const TERMINAL_SESSION_ERRORS = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'session_not_found', 'user_not_found',
])

/** Verify the cookie-bound identity with Auth; an ambiguous failure is never sign-out. */
export async function readVerifiedStudentUser(client: Awaited<ReturnType<typeof createClient>>, jwt?: string) {
  const { data, error } = await (jwt === undefined ? client.auth.getUser() : client.auth.getUser(jwt))
  const user = data?.user
  if (user === null && (!error || error.name === 'AuthSessionMissingError' ||
      (typeof error.code === 'string' && TERMINAL_SESSION_ERRORS.has(error.code)))) return null
  if (error || !user || typeof user.id !== 'string' || !user.id) throw new Error('Session validation failed')
  return user
}
