// lib/auth/config.ts — Lazy, server-only rollout and configuration checks.
import 'server-only'
import { AuthUnavailableError } from './unavailable'
import { readSupabaseConfig, readAuthSecretKey, readAuthOrigin } from './settings.cjs'

const HOSTNAME_MAX_LENGTH = 253
const HOSTNAME_LABEL_MAX_LENGTH = 63
const DEPLOYMENT_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i

const configurationUnavailable = () => new AuthUnavailableError('configuration', 'Auth configuration unavailable')

/** Only the literal true enables student authentication; missing values fail closed. */
export function isStudentAuthEnabled(): boolean {
  return process.env.STUDENT_AUTH_ENABLED === 'true'
}

/** Read public project configuration at request time, without leaking missing names. */
export function getSupabaseConfig(): { url: string; key: string } {
  return readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, configurationUnavailable)
}

/** Read the gateway/RPC key; legacy JWTs are permitted in production only for loopback Supabase. */
export function getAuthSecretKey(): string {
  return readAuthSecretKey({ NODE_ENV: process.env.NODE_ENV, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }, configurationUnavailable)
}

/** Return the canonical origin; never derive a trusted origin from request input. */
export function getAuthOrigin(): string {
  return readAuthOrigin({ NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL }, configurationUnavailable)
}

function getPreviewAuthOrigin(): string | null {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'preview') return null
  const hostname = process.env.VERCEL_URL
  if (!hostname || hostname !== hostname.trim() || hostname.length > HOSTNAME_MAX_LENGTH ||
      !DEPLOYMENT_HOSTNAME.test(hostname) ||
      hostname.split('.').some(label => label.length > HOSTNAME_LABEL_MAX_LENGTH)) return null
  return `https://${hostname.toLowerCase()}`
}

/** Accept the canonical origin and, only on Vercel Preview, the exact current deployment origin. */
export function isTrustedAuthOrigin(origin: string | null): boolean {
  if (origin === getAuthOrigin()) return true
  // Vercel supplies this hostname server-side; request Host/Origin cannot extend the trusted set.
  const previewOrigin = getPreviewAuthOrigin()
  return previewOrigin !== null && origin === previewOrigin
}
