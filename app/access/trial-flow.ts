// app/access/trial-flow.ts — What the student is told after starting a free pass (Discovery Pass) or claiming a free
// month (Early Access).
import { SIGNED_IN_ON_ANOTHER_TAB } from '@/lib/auth/constants'
import { FREE_MONTH_COPY } from '@/lib/entitlements/presentation'
import type { EntitlementResult } from '@/lib/entitlements/contract'

export type FlowMessage = { tone: 'error' | 'info' | 'success'; text: string }

/** After the answer the page stays as it is (the student may try again), reloads the server-rendered plan, or closes
 *  the offer and shows only the message. */
export type NextStep = 'stay' | 'refresh' | 'close'

/** The one answer for every refusal of this account: never a reason (an email, a period or a free month). */
export const PASS_REFUSED = 'A free pass isn’t available on this account. Free GST courses are still open to you.'

const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few minutes and try again.'
const SIGNED_OUT = 'You’ve been signed out.'
const COURSES_UPDATED = 'Your courses were just updated.'
const INVALID_REQUEST = "That didn't go through. Refresh the page and try again."

/** Plain, specific copy for every result. Never reveals anything about another account. */
export function describeResult(result: EntitlementResult): { message: FlowMessage | null; next: NextStep } {
  switch (result.status) {
    case 'pass-activated': return { next: 'refresh', message: { tone: 'success', text: 'Your free pass has started.' } }
    case 'already-activated': return { next: 'refresh', message: { tone: 'info', text: 'You’ve already used your free pass.' } }
    // Final for this account: the offer closes where it was asked for, and is not rendered again.
    case 'already-claimed':
    case 'early-access-active':
    case 'trial-not-offered': return { next: 'close', message: { tone: 'info', text: PASS_REFUSED } }
    case 'rate-limited': return { next: 'stay', message: { tone: 'error', text: TOO_MANY_ATTEMPTS } }
    case 'capacity': return { next: 'stay', message: { tone: 'error',
      text: 'Free passes aren’t available right now. Please try again later.' } }
    case 'signed-out': return { next: 'refresh', message: { tone: 'error', text: SIGNED_OUT } }
    case 'session-changed': return { next: 'refresh', message: { tone: 'error', text: SIGNED_IN_ON_ANOTHER_TAB } }
    // The courses changed in another tab: the page loads again, so the student sees which courses a pass would set.
    case 'selection-changed': return { next: 'refresh', message: { tone: 'error', text: COURSES_UPDATED } }
    case 'invalid-request': return { next: 'stay', message: { tone: 'error', text: INVALID_REQUEST } }
    case 'unavailable': return { next: 'stay', message: { tone: 'error',
      text: 'This isn’t available right now. Please try again in a few minutes.' } }
    // A free month answer never follows a free pass command; if one ever did, the plan is simply read again.
    case 'month-started':
    case 'offer-ended':
    case 'offer-unavailable': return { next: 'refresh', message: null }
  }
}

/** What happens to the free month offer on the page after the claim: it stays (the student may try again), the page
 *  loads again, the month has started (the offer goes and the page loads again), or the offer closes with a message. */
export type FreeMonthStep = 'stay' | 'refresh' | 'started' | 'close'

/**
 * Plain copy for every answer to a free month claim. Never a reason, and never a date: the page that loads next shows
 * the month's end as the database fixed it.
 */
export function describeFreeMonthResult(result: EntitlementResult): { message: FlowMessage | null; next: FreeMonthStep } {
  switch (result.status) {
    case 'invalid-request': return { next: 'stay', message: { tone: 'error', text: INVALID_REQUEST } }
    case 'month-started': return { next: 'started', message: null }
    // The claim closed while the page was open: the offer goes, where it was asked for.
    case 'offer-ended': return { next: 'close', message: { tone: 'info', text: FREE_MONTH_COPY.offerEnded } }
    case 'offer-unavailable': return { next: 'close', message: { tone: 'info', text: FREE_MONTH_COPY.unavailable } }
    case 'rate-limited': return { next: 'stay', message: { tone: 'error', text: TOO_MANY_ATTEMPTS } }
    case 'signed-out': return { next: 'refresh', message: { tone: 'error', text: SIGNED_OUT } }
    case 'session-changed': return { next: 'refresh', message: { tone: 'error', text: SIGNED_IN_ON_ANOTHER_TAB } }
    // The courses changed in another tab: the page loads again, so the student sees which courses the month would set.
    case 'selection-changed': return { next: 'refresh', message: { tone: 'error', text: COURSES_UPDATED } }
    // Nothing was started, whatever went wrong (and a free pass answer never follows this command).
    default: return { next: 'stay', message: { tone: 'error', text: FREE_MONTH_COPY.error } }
  }
}
