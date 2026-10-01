'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { btnBase, btnGhostOnBlue, btnLight, cx } from '@/components/chrome/ui'
import { useBookmarks } from '@/lib/bookmarks/client'
import type { BookmarkCourseAlias } from '@/lib/bookmarks/contract'

// variant places the button on a navy field: 'cover' = white-outline (the
// course cover), 'closing' = light/paper (the closing quiz band).
export function BookmarkButton({
  slug, code, contentKey, catalog,
  variant = 'cover',
}: {
  slug: string
  code: string
  contentKey: string
  catalog: ReadonlyArray<BookmarkCourseAlias>
  variant?: 'cover' | 'closing'
}) {
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

  const variantClass = variant === 'closing' ? btnLight : btnGhostOnBlue
  // Saved affordance per field: keep the light fill on the closing band; add a
  // faint white fill + brighter border on the white-outline cover button.
  const savedClass = variant === 'closing' ? 'bg-ci-white' : 'bg-white/10 border-white/70'

  return (
    <>
      {variant === 'cover' ? (
        <button
          type="button"
          onClick={() => { void onToggle() }}
          disabled={snapshot.mode === 'loading'}
          aria-label={unavailable ? 'Retry bookmarks' : isSaved ? 'Remove bookmark' : 'Add bookmark'}
          aria-pressed={isSaved}
          className={cx(
            'inline-flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[11px] border-[1.5px] border-white/45 text-white transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ci-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ci-navy',
            isSaved && savedClass,
          )}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={cx('h-6 w-6', isSaved ? 'text-ci-accent' : 'text-white')}
            fill={isSaved ? 'currentColor' : 'none'}
          >
            <path
              d="M7 4.75A1.75 1.75 0 0 1 8.75 3h6.5A1.75 1.75 0 0 1 17 4.75v15l-5-3.2-5 3.2v-15Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { void onToggle() }}
          disabled={snapshot.mode === 'loading'}
          aria-pressed={isSaved}
          className={cx(btnBase, variantClass, isSaved && savedClass)}
        >
          {unavailable ? 'Retry bookmarks' : isSaved ? (
            <>
              Bookmarked{' '}
              <span aria-hidden="true">✓</span>
            </>
          ) : (
            'Bookmark course'
          )}
        </button>
      )}
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
