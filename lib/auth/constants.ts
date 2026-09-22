// lib/auth/constants.ts — Shared non-secret auth rules and destinations.
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const EMAIL_MAX_LENGTH = 254
export const OTP_MAX_LENGTH = 32
export const AUTH_BODY_MAX_BYTES = 4096
export const AUTH_RETURN_PATH_MAX_LENGTH = 2048
export const AUTH_INTERNAL_SECRET_MIN_BYTES = 32
export const PASSWORD_RESET_STATE = 'password-reset'
export const AUTH_PATHS = {
  login: '/login', register: '/register', confirm: '/confirm-email',
  resend: '/resend-confirmation', forgot: '/forgot-password',
  reset: '/reset-password', account: '/account',
} as const
export const AUTH_API = {
  login: '/api/auth/login', register: '/api/auth/register', confirm: '/api/auth/confirm-email',
  resend: '/api/auth/resend-confirmation', forgot: '/api/auth/forgot-password',
  verifyRecovery: '/api/auth/verify-recovery', cancelRecovery: '/api/auth/cancel-recovery',
  reset: '/api/auth/reset-password', logout: '/api/auth/logout', session: '/api/auth/session',
} as const satisfies Record<string, `/api/auth/${string}`>
export const DEFAULT_AUTH_REDIRECT = '/courses'
export const PASSWORD_RESET_DESTINATION = AUTH_PATHS.login + '?state=' + PASSWORD_RESET_STATE
export const RECOVERY_FAILURE = { invalidCode: 'RECOVERY_CODE_INVALID', restart: 'RECOVERY_RESTART_REQUIRED' } as const
export const EMAIL_CONFIRMATION_REQUIRED = 'EMAIL_CONFIRMATION_REQUIRED'
export const AUTH_MESSAGES = {
  unavailable: 'Something went wrong. Please try again.',
  recoveryCode: 'Invalid or expired code.',
  recoveryRestart: 'Request a new reset code to continue.',
  comingSoon: 'Student accounts are coming soon.',
  confirmationRequired: 'Email confirmation is required before signing in.',
  confirmationSignIn: 'Your email is confirmed. Sign in to continue.',
  signupPassword: 'Choose a stronger password and try again.',
  samePassword: 'Choose a different password and request a new recovery code.',
  weakPassword: 'Choose a stronger password and request a new recovery code.',
  resetSuccess: 'Password updated. Sign in with your new password.',
  invalid: 'Check the information entered and try again.',
  credentials: 'Incorrect email or password.',
  code: 'Invalid or expired code.',
  limited: 'Too many attempts. Please try again later.',
  email: 'If this address can receive a confirmation email, instructions will arrive shortly.',
  recovery: 'If an account can receive a password reset email, instructions will arrive shortly.',
} as const
export const AUTH_STATUS_EVENT = 'campusintell-auth-changed'
export const AUTH_CONTINUITY_HEADER = 'x-campus-account-continuity'
export const RATE_LIMIT_POLICIES = {
  LOGIN: { account: [20, 900], origin: [30, 300] },
  REGISTER: { account: [3, 3600], origin: [20, 3600] },
  RESEND_CONFIRMATION: { account: [3, 3600], origin: [20, 3600] },
  PASSWORD_RESET_REQUEST: { account: [3, 3600], origin: [20, 3600] },
  PASSWORD_RESET_SUBMIT: { account: [5, 900], origin: [20, 900] },
  CONFIRM_EMAIL: { account: [5, 900], origin: [20, 900] },
} as const
export type AuthAction = keyof typeof RATE_LIMIT_POLICIES

export const EXISTING_STUDENT_SESSION = 'EXISTING_STUDENT_SESSION'

// Keep confirmation verification narrower than Supabase's recovery-capable email type.
export const AUTH_OTP_TYPES = { confirmation: 'signup', recovery: 'recovery' } as const
