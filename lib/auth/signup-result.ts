import 'server-only'
import { z } from 'zod'

const signup = z.object({ user: z.object({ id: z.string().min(1) }), session: z.null() }).strict()
const resend = z.object({ user: z.null(), session: z.null() }).strict()
const recovery = z.object({}).strict()

/** Validate a sessionless signup acknowledgment without branching on enumeration-obfuscated user fields. */
export function checkSignupAcknowledgment(data: unknown): void {
  // A session means confirmation configuration drifted; never silently accept auto-confirmation.
  signup.parse(data)
}

/** Validate auth-js's fixed email-resend success envelope. */
export function checkResendAcknowledgment(data: unknown): void {
  resend.parse(data)
}

/** Validate auth-js's empty recovery-initiation success envelope. */
export function checkRecoveryAcknowledgment(data: unknown): void {
  recovery.parse(data)
}
