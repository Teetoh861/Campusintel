// lib/auth/email-initiation.ts — Neutral email requests with bounded server-only diagnostics.
import 'server-only'
import { classifyEmailInitiation, classifyEmailSend } from './errors'
import type { EmailInitiationAction, EmailInitiationFailure, EmailSendOutcome } from './errors'

type Acknowledgment = { data: unknown; error: unknown }
type DiagnosticOutcome = Exclude<EmailSendOutcome, 'sent'> | 'exception' | 'invalid-acknowledgment'

function diagnose(action: EmailInitiationAction, outcome: DiagnosticOutcome): void {
  // Never serialize the provider error, recipient, request, credentials or acknowledgment.
  console.error('CampusIntell auth email initiation', { action, outcome })
}

/** Normalize provider delivery errors without hiding application configuration, limits or invalid success envelopes. */
export async function initiateAuthEmail(
  action: EmailInitiationAction,
  send: () => Promise<Acknowledgment>,
  validateAcknowledgment: (data: unknown) => void,
): Promise<EmailInitiationFailure | null> {
  let result: Acknowledgment
  try { result = await send() } catch {
    diagnose(action, 'exception')
    return null
  }
  if (result.error !== null) {
    const outcome = classifyEmailSend(result.error)
    if (outcome !== 'sent') diagnose(action, outcome)
    return classifyEmailInitiation(result.error, action)
  }
  try { validateAcknowledgment(result.data) } catch {
    diagnose(action, 'invalid-acknowledgment')
    throw new Error('Auth email acknowledgment invalid')
  }
  return null
}
