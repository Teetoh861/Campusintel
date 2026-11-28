// components/student/tap-guard.ts — A result that replaces an exam under the student's finger ignores taps for a moment.
// When the server answers between the two taps of a double tap on "End and see results", the second tap would otherwise
// press whatever the result shows in the same place (Review answers, Back to course, Subscribe).
'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

/** How long a result ignores taps after it replaces the exam: longer than a double tap. */
export const TAP_GUARD_MS = 600

const noSubscription = () => () => {}

/** The attribute that makes an element ignore taps while the guard is on (styles/student-app.css). */
export function tapGuardProps(on: boolean): { 'data-tap-guard'?: '' } {
  return on ? { 'data-tap-guard': '' } : {}
}

/** Turns a guard off TAP_GUARD_MS after it was turned on. */
export function useTapGuardTimeout(on: boolean, setOn: (on: boolean) => void): void {
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setOn(false), TAP_GUARD_MS)
    return () => clearTimeout(timer)
  }, [on, setOn])
}

/** On for TAP_GUARD_MS when the screen mounts in place of another. A screen rendered with the page is never guarded:
 * its links have to work before the page's scripts load. */
export function useTapGuard(): boolean {
  // Hydration reads the server's snapshot, so only a screen mounted after the page loaded starts guarded.
  const hydrating = useSyncExternalStore(noSubscription, () => false, () => true)
  const [on, setOn] = useState(() => !hydrating)
  useTapGuardTimeout(on, setOn)
  return on
}
