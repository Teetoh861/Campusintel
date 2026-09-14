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

/** Read the gateway/RPC key; legacy JWTs are permitted in production only for loopback Supabase. */
export function getAuthSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key || !key.trim()) throw new Error('Auth configuration unavailable')
  if (process.env.NODE_ENV === 'production') {
    let local = false
    try {
      const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
      local = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    } catch { throw new Error('Auth configuration unavailable') }
    const modern = /^sb_secret_[A-Za-z0-9_-]+$/.test(key)
    // Structural validation only: the local Supabase server validates the JWT signature/role.
    const localJwt = local && key.length >= 64 &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) &&
      key.split('.').every(segment => segment.length % 4 !== 1)
    if (!modern && !localJwt) throw new Error('Auth configuration unavailable')
  }
  if (key !== key.trim()) {
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
