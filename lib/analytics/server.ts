import 'server-only'
import { track } from '@vercel/analytics/server'
import { PRODUCT_EVENTS } from './product-events'

// The server SDK otherwise forwards request cookies and IP headers to analytics.
// Auth events need neither; pass only a fixed, non-identifying header.
const ANALYTICS_HEADERS = { 'user-agent': 'CampusIntel product events' }

async function record(name: typeof PRODUCT_EVENTS.signupConfirmed | typeof PRODUCT_EVENTS.loginSucceeded) {
  try {
    await track(name, undefined, { headers: ANALYTICS_HEADERS })
  } catch {
    // Analytics delivery must never reverse a completed authentication outcome.
  }
}

/** Record a confirmed account only after its verified session is transferred. */
export function recordConfirmedSignup(): Promise<void> {
  return record(PRODUCT_EVENTS.signupConfirmed)
}

/** Record a password login only after its verified session is transferred. */
export function recordSuccessfulLogin(): Promise<void> {
  return record(PRODUCT_EVENTS.loginSucceeded)
}
