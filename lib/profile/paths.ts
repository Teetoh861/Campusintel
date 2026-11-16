// Presentation route for the student-owned profile selection flow.
import { THEORY_QUESTION_PATH } from '@/lib/auth/redirect'

export const PROFILE_SELECTION_PATH = '/profile-selection'

/** The profile page's one title: while it loads, in every state of the form, and when it can't be shown. */
export const PROFILE_TITLE = 'Your profile'

// Where a saved selection may send the student back to: only Confirm courses, a practice result and a theory question
// on our own site, never a client-chosen destination. The theory question has the strict shape signing in returns to.
const RETURNABLE = /^\/(?:access\/checkout|courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/quiz)(?:\?[A-Za-z0-9_=&%.-]{0,160})?$/

/** A return path the selection flow accepts, or null. */
export function selectionReturnPath(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 200 && (RETURNABLE.test(raw) || THEORY_QUESTION_PATH.test(raw)) ? raw : null
}

/** The selection flow's address. With a `returnPath` the flow accepts, a save returns there; otherwise it goes home. */
export function profileSelectionHref(returnPath?: string | null): string {
  const safe = selectionReturnPath(returnPath)
  return safe === null ? PROFILE_SELECTION_PATH : `${PROFILE_SELECTION_PATH}?return=${encodeURIComponent(safe)}`
}
