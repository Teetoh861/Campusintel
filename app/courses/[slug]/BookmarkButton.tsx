// BookmarkButton — client island for the course dossier. Toggles this course
// in the on-device bookmark set that /bookmarks reads. Storage contract is
// shared with app/bookmarks/BookmarksClient.tsx: localStorage key
// `ci_bookmarks_v1`, a JSON array of course identifiers. We write the course
// *slug* (stable, unique); BookmarksClient indexes by both code and slug, so
// the two connect.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { btnBase, btnGhostOnBlue, btnLight, cx } from '@/components/chrome/ui'

const STORAGE_KEY = 'ci_bookmarks_v1'
// Same-tab sync signal. The native `storage` event only fires in *other*
// tabs, so the two BookmarkButton instances on one dossier (cover + closing)
// wouldn't otherwise stay in step when one is clicked.
const CHANGE_EVENT = 'ci:bookmarks-changed'

// Defensive read: storage is untrusted (other tabs, extensions, corruption).
// Anything malformed collapses to []. Mirrors BookmarksClient's validation.
function readKeys(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is string =>
        typeof x === 'string' && x.length > 0 && x.length < 64,
    )
  } catch {
    return []
  }
}

function writeKeys(keys: ReadonlyArray<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Storage unavailable (private mode, quota). The in-memory toggle still
    // reflects the click for this session; nothing else to do.
  }
}

// variant places the button on a navy field: 'cover' = white-outline (the
// course cover), 'closing' = light/paper (the closing quiz band). Both toggle
// the same ci_bookmarks_v1 entry.
export function BookmarkButton({
  slug,
  variant = 'cover',
}: {
  slug: string
  variant?: 'cover' | 'closing'
}) {
  // `mounted` keeps SSR output stable (always the unsaved label) so the
  // client hydration matches; the real saved state lands after the effect.
  const [mounted, setMounted] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<'added' | 'removed' | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sync = useCallback(() => {
    setSaved(readKeys().includes(slug))
  }, [slug])

  useEffect(() => {
    sync()
    setMounted(true)
    window.addEventListener('storage', sync)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(CHANGE_EVENT, sync)
    }
  }, [sync])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const showToast = useCallback((message: 'added' | 'removed') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, 3000)
  }, [])

  const toggle = useCallback(() => {
    // Re-read fresh so we never clobber a change made elsewhere; toggle this
    // slug; write back; tell sibling instances to re-sync.
    const keys = readKeys()
    const has = keys.includes(slug)
    const next = has ? keys.filter((k) => k !== slug) : [...keys, slug]
    writeKeys(next)
    setSaved(!has)
    showToast(has ? 'removed' : 'added')
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [showToast, slug])

  const isSaved = mounted && saved

  const variantClass = variant === 'closing' ? btnLight : btnGhostOnBlue
  // Saved affordance per field: keep the light fill on the closing band; add a
  // faint white fill + brighter border on the white-outline cover button.
  const savedClass = variant === 'closing' ? 'bg-ci-white' : 'bg-white/10 border-white/70'

  return (
    <>
      {variant === 'cover' ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={isSaved ? 'Remove bookmark' : 'Add bookmark'}
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
          onClick={toggle}
          aria-pressed={isSaved}
          className={cx(btnBase, variantClass, isSaved && savedClass)}
        >
          {isSaved ? (
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
          <span>{toast === 'added' ? 'Added to bookmarks' : 'Removed from bookmarks'}</span>
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
