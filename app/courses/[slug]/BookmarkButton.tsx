// app/courses/[slug]/BookmarkButton.tsx — Account-backed reversible bookmark state and existing confirmation feedback.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BookmarkToggle } from '@/components/student/BookmarkToggle'
import { useBookmarks } from '@/lib/bookmarks/client'
import type { BookmarkCourseAlias } from '@/lib/bookmarks/contract'
import type { ReactElement } from 'react'

/** Keep the same owner-bound store and retry behavior behind both course bookmark controls. */
export function BookmarkButton({
  slug, code, contentKey, catalog,
  variant = 'cover',
}: {
  slug: string
  code: string
  contentKey: string
  catalog: ReadonlyArray<BookmarkCourseAlias>
  variant?: 'cover' | 'closing'
}): ReactElement {
  const { snapshot, toggle, refresh } = useBookmarks(catalog)
  const [toast, setToast] = useState<'added' | 'removed' | 'error' | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const showToast = useCallback((message: 'added' | 'removed' | 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, 3000)
  }, [])

  const course = { slug, code, contentKey }
  const isSaved = snapshot.mode === 'account' ? snapshot.keys.includes(contentKey)
    : snapshot.mode === 'local' && (snapshot.keys.includes(slug) || snapshot.keys.includes(code))
  const unavailable = snapshot.mode === 'unavailable'
  const onToggle = async () => {
    if (unavailable) { await refresh(); return }
    const result = await toggle(course)
    showToast(result ?? 'error')
  }

  return (
    <>
      <BookmarkToggle pressed={isSaved} onClick={() => { void onToggle() }}
        disabled={snapshot.mode === 'loading'} tone={variant === 'cover' ? 'dark' : 'light'}
        label={unavailable ? 'Retry bookmarks' : `Bookmark ${code}`}
        text={variant === 'closing' ? unavailable ? 'Retry bookmarks' : 'Bookmark' : undefined} />
      {/* Path to the saved list — surfaced only once this course is saved, so
          it's relevant exactly when shown. Quiet white-on-navy link. */}
      {variant === 'closing' && isSaved ? (
        <Link
          className="inline-flex items-center gap-2 text-[15px] font-semibold text-ci-blue-200 transition-colors hover:text-white"
          href="/bookmarks"
        >
          View bookmarks
        </Link>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[100] flex w-[calc(100%-32px)] max-w-[360px] -translate-x-1/2 animate-in items-center justify-between gap-4 rounded-[12px] bg-ci-navy px-4 py-3 text-[14px] font-semibold text-ci-paper shadow-ci-soft fade-in slide-in-from-bottom-2 duration-200"
        >
          <span>{toast === 'added' ? 'Added to bookmarks' : toast === 'removed'
            ? 'Removed from bookmarks' : 'Could not update bookmarks. Try again.'}</span>
          {toast === 'added' ? (
            <Link
              href="/bookmarks"
              onClick={() => setToast(null)}
              className="flex-none rounded-[7px] bg-ci-accent px-3 py-2 text-[13px] font-bold text-ci-navy-900"
            >
              View list
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
