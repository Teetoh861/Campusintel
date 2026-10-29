// lib/auth/student-state.ts — Authoritative server validation for student session state.
import 'server-only'
import { readVerifiedStudentUser } from './verified-user'
import { isStudentRenderClient, readRenderStudentSession } from './render-session'
import { createClient } from '@/lib/supabase/server'
import { authJson } from './response'
import { EXISTING_STUDENT_SESSION, STUDENT_HOME_PATH } from './constants'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'
import type { User } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

/** Ask Auth for the cookie-bound identity; local JWT validity alone is not a live session.
 * A caller doing protected data work may pass its request-scoped client so a refreshed
 * session is used for both the live check and the subsequent RLS queries.
 */
export async function getStudentSessionUser(
  response?: NextResponse, sessionClient?: StudentClient, options: { allowRestricted?: boolean } = {},
): Promise<User | null> {
  const client = sessionClient ?? await createClient(response)
  if (response === undefined && isStudentRenderClient(client)) {
    const context = await readRenderStudentSession(client)
    if (context === null || (!options.allowRestricted && context.snapshot.lifecycle.status !== 'active')) return null
    return context.user
  }
  const user = await readVerifiedStudentUser(client)
  if (user === null) return null
  const lifecycle = await readAccountLifecycle(client)
  if (lifecycle.status === 'signed-out' || (!options.allowRestricted && lifecycle.status !== 'active')) return null
  return user
}

/** Read session identity only after the authoritative remote user check succeeds. */
export async function getStudentSessionContext(
  response?: NextResponse, sessionClient?: StudentClient, options: { allowRestricted?: boolean } = {},
): Promise<{ user: User; sessionId: string } | null> {
  const client = sessionClient ?? await createClient(response)
  if (response === undefined && isStudentRenderClient(client)) {
    const context = await readRenderStudentSession(client)
    if (context === null || (!options.allowRestricted && context.snapshot.lifecycle.status !== 'active')) return null
    return { user: context.user, sessionId: context.sessionId }
  }
  const user = await getStudentSessionUser(response, client, options)
  if (user === null) return null
  const { data, error } = await client.auth.getClaims()
  const claims = data?.claims
  if (error || claims?.sub !== user.id || typeof claims.session_id !== 'string' || !claims.session_id) {
    throw new Error('Session validation failed')
  }
  return { user, sessionId: claims.session_id }
}

/** Validate the cookie-bound identity; unexpected validation failures fail closed. */
export async function hasStudentSession(options: { allowRestricted?: boolean } = {}): Promise<boolean> {
  return (await getStudentSessionUser(undefined, undefined, options)) !== null
}

/** Reject identity-changing requests before any gateway or rate-limit operation. */
export async function rejectExistingStudent() {
  const client = await createClient()
  const user = await getStudentSessionUser(undefined, client, { allowRestricted: true })
  if (!user) return null
  const lifecycle = await readAccountLifecycle(client)
  return authJson({ code: EXISTING_STUDENT_SESSION,
    next: lifecycle.status === 'active' ? STUDENT_HOME_PATH : ACCOUNT_DELETION_PATH }, 409)
}
