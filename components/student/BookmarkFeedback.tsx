// components/student/BookmarkFeedback.tsx — The one mutation feedback for bookmark saves, removals and failures.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { studentAction } from './ui'
import type { ReactElement } from 'react'

export type BookmarkFeedbackState = 'added' | 'removed' | 'error' | null

export const BOOKMARK_FEEDBACK_COPY = {
  added: 'Added to bookmarks',
  removed: 'Removed from bookmarks',
  error: 'Could not update bookmarks. Try again.',
} as const

const SUCCESS_DISMISS_MS = 3000

/** Keep success feedback brief; a failure stays until the student acts again. */
export function useBookmarkFeedback(): [BookmarkFeedbackState, (next: BookmarkFeedbackState) => void] {
  const [state, setState] = useState<BookmarkFeedbackState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const show = useCallback((next: BookmarkFeedbackState) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setState(next)
    if (next === 'added' || next === 'removed') {
      timer.current = setTimeout(() => { setState(null); timer.current = null }, SUCCESS_DISMISS_MS)
    }
  }, [])
  return [state, show]
}

/** A persistent polite live region beside the control; the saved-list link meets the 44px target. */
export function BookmarkFeedback({ state, onDismiss }: {
  state: BookmarkFeedbackState
  onDismiss?: () => void
}): ReactElement {
  return <div role="status" aria-live="polite" aria-atomic="true"
    className="student-bookmark-feedback" data-state={state ?? 'idle'}>
    {state !== null && <span>{BOOKMARK_FEEDBACK_COPY[state]}</span>}
    {state === 'added' && <Link href={STUDENT_DESTINATIONS.bookmarks.href} prefetch={false}
      onClick={onDismiss} className={studentAction(btnGhost, 'bg-student-surface')}>View bookmarks</Link>}
  </div>
}
