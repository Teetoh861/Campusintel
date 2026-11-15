// lib/auth/constants.ts — Shared non-secret auth rules and destinations.
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { ACCOUNT_MESSAGES } from '@/lib/account/constants'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
// The Auth provider refuses a password longer than this many bytes (checked against local Auth, 2026-11-12).
export const PROVIDER_PASSWORD_MAX_BYTES = 72
export const EMAIL_MAX_LENGTH = 254
export const OTP_MAX_LENGTH = 32
export const AUTH_BODY_MAX_BYTES = 4096
export const AUTH_RETURN_PATH_MAX_LENGTH = 2048
export const AUTH_INTERNAL_SECRET_MIN_BYTES = 32
export const AUTH_PATHS = {
  login: '/login', register: '/register', confirm: '/confirm-email',
  resend: '/resend-confirmation', forgot: '/forgot-password',
  reset: '/reset-password', account: STUDENT_DESTINATIONS.account.href,
} as const
export const AUTH_API = {
  login: '/api/auth/login', register: '/api/auth/register', confirm: '/api/auth/confirm-email',
  resend: '/api/auth/resend-confirmation', forgot: '/api/auth/forgot-password',
  verifyRecovery: '/api/auth/verify-recovery', cancelRecovery: '/api/auth/cancel-recovery',
  reset: '/api/auth/reset-password', logout: '/api/auth/logout', session: '/api/auth/session',
  scheduleDeletion: '/api/auth/schedule-deletion', cancelDeletion: '/api/auth/cancel-deletion',
} as const satisfies Record<string, `/api/auth/${string}`>
export const STUDENT_HOME_PATH = STUDENT_DESTINATIONS.dashboard.href
export const OPERATOR_HOME_PATH = '/admin'
export const DEFAULT_AUTH_REDIRECT = STUDENT_HOME_PATH
// Where the Sign in button goes after a password change. The change is confirmed on the reset screen itself, so
// nothing about it travels in the address.
export const PASSWORD_RESET_DESTINATION = AUTH_PATHS.login
// restart: the grant is gone, so recovery starts again from the email. password: the provider refused the new
// password and nothing changed, so the student stays on Change password and tries another.
export const RECOVERY_FAILURE = { invalidCode: 'RECOVERY_CODE_INVALID', restart: 'RECOVERY_RESTART_REQUIRED',
  password: 'RECOVERY_PASSWORD_REJECTED' } as const
export const EMAIL_CONFIRMATION_REQUIRED = 'EMAIL_CONFIRMATION_REQUIRED'
// The provider's password rule refused a new password: one line for Create account and Change password.
const STRONGER_PASSWORD = 'Choose a stronger password.'
export const AUTH_MESSAGES = {
  unavailable: 'Something went wrong. Please try again.',
  sessionChanged: 'Your sign-in has changed. Reload this page before continuing.',
  recoveryCode: 'Invalid or expired code.',
  recoveryRestart: 'Request a new code to continue.',
  comingSoon: 'Student accounts are currently unavailable. Please try again later.',
  confirmationRequired: 'Email confirmation is required before signing in.',
  confirmationSignIn: 'Your email is confirmed. Sign in to continue.',
  signupPassword: STRONGER_PASSWORD,
  samePassword: 'Choose a different password.',
  weakPassword: STRONGER_PASSWORD,
  invalid: 'Check the information entered and try again.',
  credentials: 'Incorrect email or password.',
  code: 'Invalid or expired code.',
  limited: 'Too many attempts. Please try again later.',
  deletionPassword: ACCOUNT_MESSAGES.passwordInvalid,
  deletionExcluded: ACCOUNT_MESSAGES.excluded,
  deletionExpired: ACCOUNT_MESSAGES.expired,
  // What the server answers when a code request is accepted, the same for every address. The screen says it with
  // the address the student typed (codeSentMessage).
  email: 'We sent a new code.',
  recovery: 'We sent a new code.',
} as const

/** The line after Resend code. It reads the same whether or not the address has an account. */
export function codeSentMessage(email: string): string {
  return `We sent a new code to ${email}.`
}
export const AUTH_STATUS_EVENT = 'campusintell-auth-changed'
export const AUTH_CONTINUITY_HEADER = 'x-campus-account-continuity'
// Navigation requests this only while establishing its signed-in presentation, never on logout click.
export const AUTH_LOGOUT_CONTEXT_HEADER = 'x-campus-logout-context'
export const RATE_LIMIT_POLICIES = {
  LOGIN: { account: [20, 900], origin: [30, 300] },
  REGISTER: { account: [3, 3600], origin: [20, 3600] },
  RESEND_CONFIRMATION: { account: [3, 3600], origin: [20, 3600] },
  PASSWORD_RESET_REQUEST: { account: [3, 3600], origin: [20, 3600] },
  PASSWORD_RESET_SUBMIT: { account: [5, 900], origin: [20, 900] },
  CONFIRM_EMAIL: { account: [5, 900], origin: [20, 900] },
  ACCOUNT_DELETION: { account: [5, 900], origin: [20, 900] },
  // Discovery Pass activation has its own limiter (lib/entitlements/server.ts): a hard per-account limit and
  // per-address monitoring only, because campus networks put many students behind one address.
} as const
export type AuthAction = keyof typeof RATE_LIMIT_POLICIES

export const EXISTING_STUDENT_SESSION = 'EXISTING_STUDENT_SESSION'

// Keep confirmation verification narrower than Supabase's recovery-capable email type.
export const AUTH_OTP_TYPES = { confirmation: 'signup', recovery: 'recovery' } as const
