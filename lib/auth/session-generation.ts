import 'server-only'
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

export const STUDENT_SESSION_GENERATION_COOKIE = 'ci-student-session-generation'
// Matches the installed Supabase SSR auth-cookie lifetime; remains set while signed out.
export const STUDENT_SESSION_GENERATION_LIFETIME_SECONDS = 60 * 60 * 24 * 400
const SESSION_COOKIE_PREFIX = 'ci-student-auth-'
const GENERATION_FORMAT = /^[a-f0-9]{32}$/
const OBSOLETE_SESSION_COOKIE = /^ci-student-auth-[a-f0-9]{32}(?:\.(0|[1-9][0-9]*))?$/

export type StudentSessionNamespace =
  | { mode: 'legacy'; storageName?: undefined }
  | { mode: 'generation' | 'invalid'; storageName: string }

/** Only absence enables the SDK's unchanged legacy storage key. Malformed selectors never fall back. */
export function resolveStudentSessionNamespace(selector: unknown): StudentSessionNamespace {
  if (selector === undefined) return { mode: 'legacy' }
  if (typeof selector === 'string' && GENERATION_FORMAT.test(selector)) {
    return { mode: 'generation', storageName: SESSION_COOKIE_PREFIX + selector }
  }
  return { mode: 'invalid', storageName: SESSION_COOKIE_PREFIX + 'invalid' }
}

/** Only genuine raw absence enables legacy storage; Next may drop undecodable cookie values. */
export function resolveStudentSessionNamespaceFromCookieHeader(rawCookieHeader: string | null): StudentSessionNamespace {
  let selector: string | undefined
  let present = false
  for (const rawPair of (rawCookieHeader ?? '').split(';')) {
    const pair = rawPair.replace(/^[ \t]+|[ \t]+$/g, ''), separator = pair.indexOf('=')
    const name = separator < 0 ? pair : pair.slice(0, separator)
    if (name.trim() !== STUDENT_SESSION_GENERATION_COOKIE) continue
    // Ambiguous selectors and noncanonical names/values must never become absence.
    if (present || separator < 0 || name !== STUDENT_SESSION_GENERATION_COOKIE) {
      return resolveStudentSessionNamespace('')
    }
    present = true
    selector = pair.slice(separator + 1)
  }
  return resolveStudentSessionNamespace(selector)
}

/** A successful lifecycle transition owns selection; refreshes must never call this. */
export async function advanceStudentSessionGeneration(response: NextResponse): Promise<string> {
  const generation = randomBytes(16).toString('hex')
  const options = { httpOnly: true, sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production', path: '/' }
  // Delete only our strictly recognized generated session roots/chunks visible
  // on this request. Late obsolete cookies may reappear, but cannot become active.
  for (const cookie of (await cookies()).getAll()) {
    if (OBSOLETE_SESSION_COOKIE.test(cookie.name)) {
      response.cookies.set(cookie.name, '', { ...options, maxAge: 0, expires: new Date(0) })
    }
  }
  response.cookies.set(STUDENT_SESSION_GENERATION_COOKIE, generation,
    { ...options, maxAge: STUDENT_SESSION_GENERATION_LIFETIME_SECONDS })
  return generation
}
