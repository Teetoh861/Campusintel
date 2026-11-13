// lib/auth/schemas.ts — Strict request schemas; passwords are never transformed.
import { z } from 'zod'
import { EMAIL_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PROVIDER_PASSWORD_MAX_BYTES, OTP_MAX_LENGTH,
  AUTH_RETURN_PATH_MAX_LENGTH } from './constants'

export const emailSchema = z.string().trim().min(1, 'Enter your email.').max(EMAIL_MAX_LENGTH).email('Enter a valid email.').toLowerCase()
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(PASSWORD_MAX_LENGTH, `Use no more than ${PASSWORD_MAX_LENGTH} characters.`)
// This is an abuse bound, not an assumption about the provider's configured OTP length.
export const codeSchema = z.string().min(1, 'Enter your code.').max(OTP_MAX_LENGTH, 'Check your code.').regex(/^[0-9]+$/, 'Enter the numbers from your email.')
export const emailRequestSchema = z.object({ email: emailSchema }).strict()
// Create account refuses what the provider would refuse, on the screen: newPasswordSchema (declared below with Change
// password's rule) is read lazily because it is defined after this line.
export const registerSchema = emailRequestSchema.extend({ password: z.lazy(() => newPasswordSchema) })
export const loginSchema = emailRequestSchema.extend({ password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH, 'Incorrect email or password.'), next: z.string().max(AUTH_RETURN_PATH_MAX_LENGTH).optional() })
export const confirmSchema = emailRequestSchema.extend({ code: codeSchema, next: z.string().max(AUTH_RETURN_PATH_MAX_LENGTH).optional() })
export const recoveryVerificationSchema = emailRequestSchema.extend({ code: codeSchema })
// A new password for a reset. The provider refuses one longer than its own limit only once it is asked, and by then
// the recovery grant is in use; so that limit is checked here first, on the screen and before the grant is held.
// The provider counts bytes, so accented letters or emoji can pass the limit in fewer characters; then the line
// names no number, because the number would be wrong.
export const newPasswordSchema = passwordSchema.superRefine((value, context) => {
  if (new TextEncoder().encode(value).length <= PROVIDER_PASSWORD_MAX_BYTES) return
  context.addIssue({ code: 'custom', message: Array.from(value).length > PROVIDER_PASSWORD_MAX_BYTES
    ? `Use no more than ${PROVIDER_PASSWORD_MAX_BYTES} characters.` : 'Use a shorter password.' })
})
export const resetSchema = emailRequestSchema.extend({ password: newPasswordSchema })
export const logoutSchema = z.object({}).strict()
export const scheduleDeletionSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH), confirmed: z.literal(true),
}).strict()
export const cancelDeletionSchema = z.object({ requestId: z.string().uuid() }).strict()
