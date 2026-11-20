import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { AUTH_API, AUTH_MESSAGES } from './constants'

export type AuthFailureStep = 'requester-address' | 'rate-limit' | 'configuration' | 'identity'
  | 'provider' | 'timeout' | 'unexpected'
export type AuthUnavailableReason = { step: AuthFailureStep; code: string | null }
export type AuthUnavailableContext = { route: string; reason?: AuthUnavailableReason }
export type AuthDiagnostic = { route: string; reference: string; started: number; reported: boolean; clearCookies: Set<string> }

const context = new AsyncLocalStorage<AuthDiagnostic>()
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PROVIDER_CODES = new Set(['bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used', 'session_expired',
  'session_not_found', 'user_not_found', 'user_banned', 'unexpected_failure', 'request_timeout', 'validation_failed',
  'signup_disabled', 'email_provider_disabled', 'email_not_confirmed', 'invalid_credentials', 'otp_expired',
  'otp_disabled', 'over_request_rate_limit', 'over_email_send_rate_limit', 'weak_password', 'same_password'])
const STATIC_ROUTES = new Set<string>([...Object.values(AUTH_API), '/', '/login', '/register', '/confirm-email',
  '/resend-confirmation', '/forgot-password', '/reset-password', '/account', '/account/deletion', '/profile-selection',
  '/dashboard', '/courses', '/bookmarks', '/materials', '/api/entitlements'])

/** Log route names only: no submitted query, slug or other arbitrary path. */
export function authDiagnosticRoute(route: string): string {
  if (STATIC_ROUTES.has(route)) return route
  if (route.startsWith('/courses/')) return '/courses/[slug]'
  return '/auth'
}

/** A request reference is random, non-authorizing and independent of student data. */
export function createAuthDiagnostic(route: string): AuthDiagnostic {
  return { route: authDiagnosticRoute(route),
    reference: Array.from(randomBytes(8), byte => REFERENCE_ALPHABET[byte & 31]).join(''),
    started: performance.now(), reported: false, clearCookies: new Set() }
}

/** Establish one diagnostic lifetime for an auth route, including asynchronous helpers. */
export function runAuthDiagnostic<T>(route: string, operation: (diagnostic: AuthDiagnostic) => Promise<T>): Promise<T> {
  const diagnostic = createAuthDiagnostic(route)
  return context.run(diagnostic, () => operation(diagnostic))
}

/** Entry guards can clear an invalid cookie even before a route has constructed its response. */
export function queueInvalidAuthCookie(name: string): void { context.getStore()?.clearCookies.add(name) }

/** Carry only a bounded diagnostic; an arbitrary exception is never serialized. */
export class AuthUnavailableError extends Error {
  readonly status = 503
  readonly reason: AuthUnavailableReason
  constructor(step: AuthFailureStep, message = 'Auth unavailable', code: unknown = null) {
    super(message)
    this.reason = { step, code: boundedCode(step, code) }
  }
}

function boundedCode(step: AuthFailureStep, code: unknown): string | null {
  if (typeof code !== 'string') return null
  if (step === 'requester-address') return ['missing', 'list', 'invalid'].includes(code) ? code : null
  if (step === 'rate-limit') return /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code) ? code : null
  if (step === 'identity') return PROVIDER_CODES.has(code) || /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code) ? code : null
  if (step === 'provider') return PROVIDER_CODES.has(code) ? code : null
  if (step === 'timeout') return ['identity', 'provider', 'rate-limit'].includes(code) ? code : null
  return null
}

/** Keep safe categories through helpers without retaining provider text or request data. */
export function authUnavailableReason(error: unknown, fallback: AuthFailureStep = 'unexpected'): AuthUnavailableReason {
  if (error instanceof AuthUnavailableError) return error.reason
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return code === 'request_timeout' ? { step: 'timeout', code: fallback === 'identity' ? 'identity' : 'provider' }
    : { step: fallback, code: boundedCode(fallback, code) }
}

/** Translate an upstream failure without including its message, detail, request or credentials. */
export function authUnavailable(error: unknown, fallback: AuthFailureStep, message = 'Auth unavailable'): AuthUnavailableError {
  if (error instanceof AuthUnavailableError) return error
  const reason = authUnavailableReason(error, fallback)
  return new AuthUnavailableError(reason.step, message, reason.code)
}

function deployment(): string {
  const id = process.env.VERCEL_DEPLOYMENT_ID
  if (id && /^dpl_[A-Za-z0-9]{1,80}$/.test(id)) return id
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
  if (commit && /^[a-f0-9]{40}$/.test(commit)) return commit
  return process.env.VERCEL === '1' ? 'unknown' : 'local'
}

function emit(diagnostic: AuthDiagnostic, reason: AuthUnavailableReason,
  event: 'CampusIntell auth unavailable' | 'CampusIntell auth address unknown' = 'CampusIntell auth unavailable',
): void {
  const { route, reference } = diagnostic
  const { step } = reason
  const code = boundedCode(step, reason.code)
  const durationMs = Math.max(0, Math.round(performance.now() - diagnostic.started))
  console.error(event, { route, step, code, reference, deployment: deployment(), durationMs })
}

/** Report one unavailable outcome at its response/page boundary. */
export function logAuthUnavailable({ route, reason = { step: 'unexpected', code: null } }: AuthUnavailableContext,
  diagnostic = context.getStore() ?? createAuthDiagnostic(route),
): AuthDiagnostic {
  if (!diagnostic.reported) { diagnostic.reported = true; emit(diagnostic, reason) }
  return diagnostic
}

/** Missing address is recoverable admission, not a reason to refuse the request. */
export function logUnknownRequester(route: string, shape: 'missing' | 'list' | 'invalid'): void {
  emit(context.getStore() ?? createAuthDiagnostic(route), { step: 'requester-address', code: shape },
    'CampusIntell auth address unknown')
}

/** Attach a support reference, preserving instructions for operations that may already have completed. */
export function authUnavailableBody(body: Record<string, unknown>, status: number, unavailable?: AuthUnavailableContext): Record<string, unknown> {
  if (body.error === AUTH_MESSAGES.comingSoon) return body
  if (!unavailable && !context.getStore()) return body
  if (status !== 503 && body.error !== AUTH_MESSAGES.unavailable) return body
  const diagnostic = logAuthUnavailable(unavailable ?? { route: context.getStore()?.route ?? '/auth' })
  return { ...body, reference: diagnostic.reference,
    ...(unavailable?.reason?.step === 'timeout' ? { status: 'timeout' } : {}) }
}

/** Failed page guards log their diagnostic and show only the student-facing message. */
export function authUnavailableMessage(route: string, error: unknown, diagnostic?: AuthDiagnostic): string {
  logAuthUnavailable({ route, reason: authUnavailableReason(error, 'identity') }, diagnostic)
  return AUTH_MESSAGES.unavailable
}

/** PostgREST and PostgreSQL codes only; malformed or absent codes disclose nothing. */
export function rateLimitUnavailable(code: unknown): AuthUnavailableError {
  return new AuthUnavailableError('rate-limit', 'Auth rate limit unavailable', code)
}
