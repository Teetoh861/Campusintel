// lib/auth/student-state.ts — Prevent a current student identity from entering another identity flow.
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { authJson } from './response'
import { AUTH_PATHS, EXISTING_STUDENT_SESSION } from './constants'

/** Validate the cookie-bound identity; unexpected validation failures fail closed. */
export async function hasStudentSession(): Promise<boolean> {
  const client = await createClient()
  const { data, error } = await client.auth.getUser()
  if (error && error.name !== 'AuthSessionMissingError') throw new Error('Session validation failed')
  if (data.user === null) return false
  if (error || typeof data.user?.id !== 'string' || !data.user.id) throw new Error('Session result invalid')
  return true
}

/** Reject identity-changing requests before any gateway or rate-limit operation. */
export async function rejectExistingStudent() {
  return await hasStudentSession()
    ? authJson({ code: EXISTING_STUDENT_SESSION, next: AUTH_PATHS.account }, 409)
    : null
}
