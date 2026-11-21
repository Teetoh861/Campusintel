// lib/auth/email-initiation.ts — Neutral email requests with bounded server-only diagnostics.
import 'server-only'
import { classifyEmailInitiation, classifyEmailSend } from './errors'
import type { EmailInitiationAction, EmailInitiationFailure, EmailSendOutcome } from './errors'
import { authUnavailable, AuthUnavailableError } from './unavailable'

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
  try { result = await send() } catch (error) {
    if (error instanceof AuthUnavailableError && error.reason.step === 'timeout') throw error
    diagnose(action, 'exception')
    return null
  }
  if (result.error !== null) {
    if (authUnavailable(result.error, 'provider').reason.step === 'timeout') throw authUnavailable(result.error, 'provider')
    const outcome = classifyEmailSend(result.error)
    if (outcome !== 'sent') diagnose(action, outcome)
    return classifyEmailInitiation(result.error, action)
  }
  try { validateAcknowledgment(result.data) } catch {
    diagnose(action, 'invalid-acknowledgment')
    throw authUnavailable(null, 'provider', 'Auth email acknowledgment invalid')
  }
  return null
}
