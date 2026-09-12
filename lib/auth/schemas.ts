// lib/auth/schemas.ts — Strict request schemas; passwords are never transformed.
import { z } from 'zod'
import { EMAIL_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, OTP_MAX_LENGTH, AUTH_RETURN_PATH_MAX_LENGTH } from './constants'

export const emailSchema = z.string().trim().max(EMAIL_MAX_LENGTH).email().toLowerCase()
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
// This is an abuse bound, not an assumption about the provider's configured OTP length.
export const codeSchema = z.string().min(1).max(OTP_MAX_LENGTH).regex(/^[0-9]+$/)
export const emailRequestSchema = z.object({ email: emailSchema }).strict()
export const registerSchema = emailRequestSchema.extend({ password: passwordSchema })
export const loginSchema = registerSchema.extend({ next: z.string().max(AUTH_RETURN_PATH_MAX_LENGTH).optional() })
export const confirmSchema = emailRequestSchema.extend({ code: codeSchema, next: z.string().max(AUTH_RETURN_PATH_MAX_LENGTH).optional() })
export const resetSchema = emailRequestSchema.extend({ code: codeSchema, password: passwordSchema })
export const logoutSchema = z.object({}).strict()
