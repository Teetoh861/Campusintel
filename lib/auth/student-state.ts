// lib/auth/student-state.ts — Authoritative server validation for student session state.
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { authJson } from './response'
import { AUTH_PATHS, EXISTING_STUDENT_SESSION } from './constants'
import type { User } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const TERMINAL_SESSION_ERRORS = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_expired',
])

/** Ask Auth for the cookie-bound identity; local JWT validity alone is not a live session.
 * A caller doing protected data work may pass its request-scoped client so a refreshed
 * session is used for both the live check and the subsequent RLS queries.
 */
export async function getStudentSessionUser(response?: NextResponse, sessionClient?: StudentClient): Promise<User | null> {
  const client = sessionClient ?? await createClient(response)
  const { data, error } = await client.auth.getUser()
  const user = data?.user
  if (user === null && (!error || error.name === 'AuthSessionMissingError' ||
      (typeof error.code === 'string' && TERMINAL_SESSION_ERRORS.has(error.code)))) return null
  if (error || !user || typeof user.id !== 'string' || !user.id) throw new Error('Session validation failed')
  return user
}

/** Validate the cookie-bound identity; unexpected validation failures fail closed. */
export async function hasStudentSession(): Promise<boolean> {
  return (await getStudentSessionUser()) !== null
}

/** Reject identity-changing requests before any gateway or rate-limit operation. */
export async function rejectExistingStudent() {
  return await hasStudentSession()
    ? authJson({ code: EXISTING_STUDENT_SESSION, next: AUTH_PATHS.account }, 409)
    : null
}
