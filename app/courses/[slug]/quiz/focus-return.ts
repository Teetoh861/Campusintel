// app/courses/[slug]/quiz/focus-return.ts — When an overlay closes, hand focus to the first stable control that accepts it.
import type { RefObject } from 'react'

// A control named directly, or a ref read only when the overlay closes, so a re-rendered owner is never stale.
export type FocusCandidate = HTMLElement | RefObject<HTMLElement | null> | null | undefined
export type ReturnFocus = ReadonlyArray<FocusCandidate>

/** Focus the first connected candidate that actually takes focus; false leaves the primitive's own default in place. */
export function focusFirst(candidates: ReturnFocus): boolean {
  for (const named of candidates) {
    const candidate = named && 'current' in named ? named.current : named
    if (!candidate?.isConnected) continue
    candidate.focus()
    if (document.activeElement === candidate) return true
  }
  return false
}
