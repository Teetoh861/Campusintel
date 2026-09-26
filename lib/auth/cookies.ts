// lib/auth/cookies.ts — Preserve SSR cookie metadata while enforcing the student boundary.
import 'server-only'
import type { CookieOptions } from '@supabase/ssr'

/** Harden library-supplied cookies without changing names, expiry or chunking metadata. */
export function getStudentCookieOptions(options: CookieOptions): CookieOptions {
  return { ...options, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }
}
