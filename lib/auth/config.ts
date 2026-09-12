// lib/auth/config.ts — Lazy, server-only rollout and configuration checks.
import 'server-only'

/** Only the literal true enables student authentication; missing values fail closed. */
export function isStudentAuthEnabled(): boolean {
  return process.env.STUDENT_AUTH_ENABLED === 'true'
}

/** Read public project configuration at request time, without leaking missing names. */
export function getSupabaseConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Auth configuration unavailable')
  return { url, key }
}

/** Read the narrowly scoped gateway/RPC key. Production requires a modern secret key. */
export function getAuthSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key || (process.env.NODE_ENV === 'production' && !key.startsWith('sb_secret_'))) {
    throw new Error('Auth configuration unavailable')
  }
  return key
}

/** Return the canonical origin; never derive a trusted origin from request input. */
export function getAuthOrigin(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || '')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Auth configuration unavailable')
  }
  return url.origin
}
