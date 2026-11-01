// lib/auth/chrome-state.ts — The proxy's live session answer for the first render; presentation only, never authorization.

/** Request header the proxy always replaces before rendering; a client-sent value never reaches a page. */
export const CHROME_STATE_HEADER = 'x-campus-chrome-state'
// Routing hint only; always overwritten by the proxy. Never carries identity or authorization.
export const STUDENT_RENDER_PATH_HEADER = 'x-campus-student-render-path'

export type ChromeState = 'signed-in' | 'signed-out' | 'unknown'

/** Anything other than an exact proxy answer (including absence) is unknown. */
export function parseChromeState(value: string | null | undefined): ChromeState {
  return value === 'signed-in' || value === 'signed-out' ? value : 'unknown'
}
