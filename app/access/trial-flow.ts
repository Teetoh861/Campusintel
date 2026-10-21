// app/access/trial-flow.ts — What the student is told after the Discovery Pass activation command.
import type { EntitlementResult } from '@/lib/entitlements/contract'

export type FlowMessage = { tone: 'error' | 'info' | 'success'; text: string }

/** After the answer the page either stays as it is or reloads the server-rendered plan. */
export type NextStep = 'stay' | 'refresh'

function dayDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'soon'
    : date.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Plain, specific copy for every result. Never reveals anything about another account. */
export function describeResult(result: EntitlementResult): { message: FlowMessage | null; next: NextStep } {
  switch (result.status) {
    case 'pass-activated': return { next: 'refresh', message: { tone: 'success', text: 'Your pass is active. Updating your plan…' } }
    case 'already-activated': return { next: 'refresh', message: { tone: 'info',
      text: 'This account has already had its Discovery Pass. Updating your plan…' } }
    case 'already-claimed': return { next: 'stay', message: { tone: 'error',
      text: `This email address has had a Discovery Pass in the last ${result.retentionMonths} months, so another ` +
        'can’t be started yet. GST courses stay free.' } }
    case 'early-access-active': return { next: 'refresh', message: { tone: 'info',
      text: `You already have full access through Early Access. Your Discovery Pass opens after it ends (${dayDate(result.availableFrom)}).` } }
    case 'trial-not-offered': return { next: 'refresh', message: { tone: 'info',
      text: 'The Discovery Pass is not offered to accounts that have had Early Access.' } }
    case 'rate-limited': return { next: 'stay', message: { tone: 'error',
      text: 'Too many attempts. Please wait a few minutes and try again.' } }
    case 'capacity': return { next: 'stay', message: { tone: 'error',
      text: 'Passes can’t be started right now because of high demand. Please try again later.' } }
    case 'signed-out':
    case 'session-changed': return { next: 'refresh', message: { tone: 'error',
      text: 'Your session changed. Refresh the page and sign in again.' } }
    case 'invalid-request': return { next: 'stay', message: { tone: 'error', text: 'Something went wrong. Please try again.' } }
    case 'unavailable': return { next: 'stay', message: { tone: 'error',
      text: 'This isn’t available right now. Please try again in a few minutes.' } }
  }
}
