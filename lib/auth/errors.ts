// lib/auth/errors.ts — Auth-domain translation; provider text never becomes product copy.
import { AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED } from './constants'

type Failure = { status: number; error: string; code?: typeof EMAIL_CONFIRMATION_REQUIRED }

/** Translate only known provider codes in the context where they are actionable. */
export function mapAuthFailure(error: unknown, action: 'login' | 'otp' | 'reset'): Failure {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (action === 'login' && code === 'email_not_confirmed') {
    return { status: 200, code: EMAIL_CONFIRMATION_REQUIRED, error: AUTH_MESSAGES.confirmationRequired }
  }
  if (action === 'login' && code === 'invalid_credentials') return { status: 400, error: AUTH_MESSAGES.credentials }
  if (action === 'otp' && (code === 'otp_expired' || code === 'otp_disabled')) return { status: 400, error: AUTH_MESSAGES.code }
  if (action === 'reset' && code === 'same_password') return { status: 400, error: AUTH_MESSAGES.samePassword }
  if (action === 'reset' && code === 'weak_password') return { status: 400, error: AUTH_MESSAGES.weakPassword }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return { status: 429, error: AUTH_MESSAGES.limited }
  return { status: 503, error: AUTH_MESSAGES.unavailable }
}

/** Whitelist application copy as a final boundary, including untrusted HTTP error responses. */
export function safeAuthMessage(message: unknown): string {
  return typeof message === 'string' && Object.values(AUTH_MESSAGES).some(value => value === message)
    ? message : AUTH_MESSAGES.unavailable
}

/** Suppress recipient-dependent outcomes; infrastructure failures remain generic. */
export function checkEmailInitiation(error: unknown): void {
  if (!error) return
  const code = typeof error === 'object' && 'code' in error ? error.code : undefined
  if (typeof code === 'string' && ['user_already_exists', 'email_exists', 'user_not_found',
    'email_not_confirmed', 'over_email_send_rate_limit', 'over_request_rate_limit'].includes(code)) return
  throw new Error('Email initiation failed')
}
