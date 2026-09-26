import 'server-only'
import { z } from 'zod'

const identity = z.object({ id: z.string().min(1), email: z.string().email(), email_confirmed_at: z.string().min(1) })
const result = z.object({ user: identity, session: z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), user: identity,
}) })

/** Require a confirmed, matching provider identity before transferring or accepting a session. */
export function requireVerifiedSession(data: unknown, email: string) {
  const parsed = result.parse(data)
  if (parsed.user.id !== parsed.session.user.id || parsed.user.email.toLowerCase() !== email ||
      parsed.session.user.email.toLowerCase() !== email) throw new Error('Session identity mismatch')
  return parsed.session
}
