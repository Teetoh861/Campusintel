// app/access/trial-flow.ts — What the student is told after each trial activation command.
import type { EntitlementResult } from '@/lib/entitlements/contract'

export type FlowMessage = { tone: 'error' | 'info' | 'success'; text: string }

/** After a refusal the student either fixes the code, starts over with a new code, or stops. */
export type NextStep = 'stay' | 'restart' | 'refresh'

function clockTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'later'
    : date.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false })
}

function dayDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'soon'
    : date.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Plain, specific copy for every result. Never reveals anything about another account. */
export function describeResult(result: EntitlementResult): { message: FlowMessage | null; next: NextStep } {
  switch (result.status) {
    case 'code-sent': return { next: 'stay', message: { tone: 'info',
      text: `We sent a 6-digit code to the number ending ${result.phoneHint}.` } }
    case 'delivery-failed': return { next: 'stay', message: { tone: 'error',
      text: 'We couldn’t deliver the code. Check the number and send it again; a failed send never uses up your trial.' } }
    case 'cooldown': return { next: 'stay', message: { tone: 'info',
      text: `Please wait before asking for another code. You can try again at ${clockTime(result.retryAt)}.` } }
    case 'rate-limited': return { next: 'stay', message: { tone: 'error',
      text: `Too many codes have been requested. Try again after ${clockTime(result.retryAt)} (Lagos time).` } }
    case 'incorrect': return { next: 'stay', message: { tone: 'error', text: result.attemptsLeft === 1
      ? 'That code is not right. You have 1 attempt left.' : `That code is not right. You have ${result.attemptsLeft} attempts left.` } }
    case 'trial-activated':
    case 'already-activated': return { next: 'refresh', message: { tone: 'success', text: 'Done. Updating your plan…' } }
    case 'early-access-active': return { next: 'refresh', message: { tone: 'info',
      text: `You already have full access through Early Access. Your free trial opens after it ends (${dayDate(result.availableFrom)}).` } }
    case 'trial-not-offered': return { next: 'refresh', message: { tone: 'info',
      text: 'The free trial is not offered to accounts that have had Early Access.' } }
    case 'invalid-phone': return { next: 'stay', message: { tone: 'error',
      text: 'Enter a Nigerian mobile number, for example 0803 123 4567.' } }
    case 'phone-already-used': return { next: 'restart', message: { tone: 'error',
      text: 'This phone number has already been used for a free trial. Each number can start one trial. ' +
        'If you think this is a mistake, contact support.' } }
    case 'expired': return { next: 'restart', message: { tone: 'error', text: 'That code has expired. Send a new code.' } }
    case 'superseded': return { next: 'restart', message: { tone: 'error',
      text: 'A newer code was sent. Use the latest code, or send a new one.' } }
    case 'already-used': return { next: 'refresh', message: { tone: 'info', text: 'That code was already used.' } }
    case 'too-many-attempts': return { next: 'restart', message: { tone: 'error',
      text: 'Too many wrong attempts for this code. Send a new code.' } }
    case 'capacity': return { next: 'stay', message: { tone: 'error',
      text: 'We can’t send codes right now because of high demand. Please try again later.' } }
    case 'signed-out':
    case 'session-changed': return { next: 'refresh', message: { tone: 'error',
      text: 'Your session changed. Refresh the page and sign in again.' } }
    case 'invalid-request': return { next: 'stay', message: { tone: 'error', text: 'Check what you entered and try again.' } }
    case 'unavailable': return { next: 'stay', message: { tone: 'error',
      text: 'This isn’t available right now. Please try again in a few minutes.' } }
  }
}
