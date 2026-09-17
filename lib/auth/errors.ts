// lib/auth/errors.ts — Auth-domain translation; provider text never becomes product copy.
import { AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED } from './constants'

type Failure = { status: number; error: string; code?: typeof EMAIL_CONFIRMATION_REQUIRED }

/** Translate only known provider codes in the context where they are actionable. */
export function mapAuthFailure(error: unknown, action: 'login' | 'otp' | 'recoveryOtp' | 'reset'): Failure {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (action === 'login' && code === 'email_not_confirmed') {
    return { status: 200, code: EMAIL_CONFIRMATION_REQUIRED, error: AUTH_MESSAGES.confirmationRequired }
  }
  if (action === 'login' && (code === 'invalid_credentials' || code === 'user_banned')) return { status: 400, error: AUTH_MESSAGES.credentials }
  if ((action === 'otp' || action === 'recoveryOtp') && (code === 'otp_expired' || code === 'otp_disabled' || code === 'user_banned')) {
    return { status: 400, error: action === 'recoveryOtp' ? AUTH_MESSAGES.recoveryCode : AUTH_MESSAGES.code }
  }
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

/** GoTrue reuses over_email_send_rate_limit for its per-recipient cooldown ("For security purposes, you can
 * only request this after N seconds.", ~30s hosted) and its project-wide send quota ("email rate limit exceeded").
 * Only the cooldown depends on account state: it is emitted after the recipient lookup, so a nonexistent address
 * receives a silent 200 instead. The quota and over_request_rate_limit apply before any lookup. */
const RECIPIENT_COOLDOWN = /^for security purposes/i

export type EmailSendOutcome = 'sent' | 'cooldown' | 'limited' | 'policy' | 'failed'

/** One authoritative reading of a provider email-send result; callers decide what each outcome means for their flow. */
export function classifyEmailSend(error: unknown): EmailSendOutcome {
  if (error === null) return 'sent'
  const code = typeof error === 'object' && 'code' in error ? error.code : undefined
  const status = typeof error === 'object' && 'status' in error ? error.status : undefined
  const message = typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (code === 'over_email_send_rate_limit' && RECIPIENT_COOLDOWN.test(message)) return 'cooldown'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) return 'limited'
  if (code === 'weak_password') return 'policy'
  return 'failed'
}

/** Accepted sends and recipient cooldowns share one neutral acknowledgment: a cooldown rejection is only ever
 * returned for an existing recipient, so exposing it would answer whether the address is registered. A cooldown
 * never issues a new code; the prior confirmation code stays usable, while a prior recovery code may already be
 * consumed, which only the verification endpoint decides. Recipient-independent limits and failures stay truthful. */
export function classifyEmailInitiation(error: unknown, action: 'register' | 'resend' | 'recovery'): Failure | null {
  const outcome = classifyEmailSend(error)
  if (outcome === 'sent' || outcome === 'cooldown') return null
  if (outcome === 'limited') return { status: 429, error: AUTH_MESSAGES.limited }
  if (outcome === 'policy' && action === 'register') return { status: 400, error: AUTH_MESSAGES.signupPassword }
  return { status: 503, error: AUTH_MESSAGES.unavailable }
}
