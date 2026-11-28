import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { clearInvalidStudentSession, isInvalidStudentCredential } from './invalid-session'
import { authUnavailable } from './unavailable'

/** Verify the cookie-bound identity with Auth; an ambiguous failure is never sign-out. */
export async function readVerifiedStudentUser(client: Awaited<ReturnType<typeof createClient>>, jwt?: string) {
  let answer: Awaited<ReturnType<typeof client.auth.getUser>>
  try { answer = await (jwt === undefined ? client.auth.getUser() : client.auth.getUser(jwt)) }
  catch (error) { throw authUnavailable(error, 'identity') }
  const data = answer?.data, error = answer?.error
  const user = data?.user
  if (isInvalidStudentCredential(error)) { clearInvalidStudentSession(client); return null }
  if (user === null && !error) return null
  if (error || !user || typeof user.id !== 'string' || !user.id) throw authUnavailable(error, 'identity')
  return user
}
