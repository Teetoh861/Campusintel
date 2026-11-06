// Presentation route for the student-owned profile selection flow.
export const PROFILE_SELECTION_PATH = '/profile-selection'

// Where a saved selection may send the student back to: only Confirm courses and a practice result on our own site,
// never a client-chosen destination.
const RETURNABLE = /^\/(?:access\/checkout|courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/quiz)(?:\?[A-Za-z0-9_=&%.-]{0,160})?$/

/** A return path the selection flow accepts, or null. */
export function selectionReturnPath(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 200 && RETURNABLE.test(raw) ? raw : null
}

/** The selection flow, returning to `returnPath` after a save when it is one we accept. */
export function profileSelectionHref(returnPath?: string | null): string {
  const safe = selectionReturnPath(returnPath)
  return safe === null ? PROFILE_SELECTION_PATH : `${PROFILE_SELECTION_PATH}?return=${encodeURIComponent(safe)}`
}
