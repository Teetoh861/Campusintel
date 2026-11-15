// app/access/trial-flow.ts — What the student is told after the free pass (Discovery Pass) activation command.
import type { EntitlementResult } from '@/lib/entitlements/contract'

export type FlowMessage = { tone: 'error' | 'info' | 'success'; text: string }

/** After the answer the page stays as it is (the student may try again), reloads the server-rendered plan, or closes
 *  the offer and shows only the message. */
export type NextStep = 'stay' | 'refresh' | 'close'

/** The one answer for every refusal of this account: never a reason (an email, a period or Early Access). */
export const PASS_REFUSED = 'A free pass isn’t available on this account. Free GST courses are still open to you.'

/** Plain, specific copy for every result. Never reveals anything about another account. */
export function describeResult(result: EntitlementResult): { message: FlowMessage | null; next: NextStep } {
  switch (result.status) {
    case 'pass-activated': return { next: 'refresh', message: { tone: 'success', text: 'Your pass is active. Updating your plan…' } }
    case 'already-activated': return { next: 'refresh', message: { tone: 'info',
      text: 'This account has already had its free pass. Updating your plan…' } }
    // Final for this account: the offer closes where it was asked for, and is not rendered again.
    case 'already-claimed':
    case 'early-access-active':
    case 'trial-not-offered': return { next: 'close', message: { tone: 'info', text: PASS_REFUSED } }
    case 'rate-limited': return { next: 'stay', message: { tone: 'error',
      text: 'Too many attempts. Please wait a few minutes and try again.' } }
    case 'capacity': return { next: 'stay', message: { tone: 'error',
      text: 'Passes can’t be started right now because of high demand. Please try again later.' } }
    case 'signed-out':
    case 'session-changed': return { next: 'refresh', message: { tone: 'error', text: 'Your sign-in has changed.' } }
    // The courses changed in another tab: the page loads again, so the student sees which courses a pass would set.
    case 'selection-changed': return { next: 'refresh', message: { tone: 'error', text: 'Your courses were just updated.' } }
    case 'invalid-request': return { next: 'stay', message: { tone: 'error', text: 'Something went wrong. Please try again.' } }
    case 'unavailable': return { next: 'stay', message: { tone: 'error',
      text: 'This isn’t available right now. Please try again in a few minutes.' } }
  }
}
