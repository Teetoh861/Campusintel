// app/courses/[slug]/BookmarkButton.tsx — Account-backed reversible bookmark state with the shared mutation feedback.
'use client'

import { useEffect, useRef, useState } from 'react'
import { BookmarkFeedback, useBookmarkFeedback } from '@/components/student/BookmarkFeedback'
import { BookmarkToggle } from '@/components/student/BookmarkToggle'
import { useBookmarks } from '@/lib/bookmarks/client'
import type { BookmarkCourseAlias } from '@/lib/bookmarks/contract'
import type { ReactElement } from 'react'

/** The one course bookmark control, on the shared owner-bound store with its retry behavior. */
export function BookmarkButton({ slug, code, contentKey, catalog }: {
  slug: string
  code: string
  contentKey: string
  catalog: ReadonlyArray<BookmarkCourseAlias>
}): ReactElement {
  const { snapshot, toggle, refresh } = useBookmarks(catalog)
  const [feedback, showFeedback] = useBookmarkFeedback()
  const [retries, setRetries] = useState(0)
  const reportedRetries = useRef(0)
  const course = { slug, code, contentKey }
  const isSaved = snapshot.mode === 'account' ? snapshot.keys.includes(contentKey)
    : snapshot.mode === 'local' && (snapshot.keys.includes(slug) || snapshot.keys.includes(code))
  const unavailable = snapshot.mode === 'unavailable'
  // A completed retry reports the refreshed snapshot once: still unavailable is a failure,
  // anything else clears feedback; the control itself shows the restored bookmark state.
  useEffect(() => {
    if (retries === reportedRetries.current) return
    reportedRetries.current = retries
    showFeedback(snapshot.mode === 'unavailable' ? 'error' : null)
  }, [retries, snapshot.mode, showFeedback])
  const onToggle = async () => {
    if (unavailable) {
      showFeedback(null)
      await refresh()
      setRetries(count => count + 1)
      return
    }
    showFeedback((await toggle(course)) ?? 'error')
  }
  return <>
    <BookmarkToggle pressed={isSaved} onClick={() => { void onToggle() }}
      disabled={snapshot.mode === 'loading'}
      label={unavailable ? 'Retry bookmarks' : `Bookmark ${code}`}
      text={unavailable ? 'Retry bookmarks' : 'Bookmark'} />
    <BookmarkFeedback state={feedback} onDismiss={() => showFeedback(null)} />
  </>
}
