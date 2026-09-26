// Endpoint-specific response contracts. An acknowledgment is never proof of delivery.
import { z } from 'zod'
import { AUTH_API, AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED, PASSWORD_RESET_DESTINATION } from './constants'
import { getSafeReturnPath } from './redirect'

const destination = z.string().refine(value => value === getSafeReturnPath(value))
const signedIn = z.object({ next: destination }).strict()
const confirmation = z.object({ code: z.literal(EMAIL_CONFIRMATION_REQUIRED) }).strict()
const email = z.object({ message: z.literal(AUTH_MESSAGES.email) }).strict()
const recovery = z.object({ message: z.literal(AUTH_MESSAGES.recovery) }).strict()
const verified = z.object({ verified: z.literal(true) }).strict()
const completed = z.object({ success: z.literal(true) }).strict()
const reset = z.object({ next: z.literal(PASSWORD_RESET_DESTINATION) }).strict()

/** Validate each flow's own evidence before callers can act on a successful HTTP response. */
export function parseAuthOutcome(endpoint: string, value: unknown) {
  switch (endpoint) {
    case AUTH_API.register: case AUTH_API.resend: return email.parse(value)
    case AUTH_API.forgot: return recovery.parse(value)
    case AUTH_API.login: return z.union([signedIn, confirmation]).parse(value)
    case AUTH_API.confirm: return signedIn.parse(value)
    case AUTH_API.verifyRecovery: return verified.parse(value)
    case AUTH_API.reset: return reset.parse(value)
    case AUTH_API.logout: case AUTH_API.cancelRecovery: return completed.parse(value)
    default: throw new Error('Invalid auth operation')
  }
}
