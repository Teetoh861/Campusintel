// BookmarksClient — Variant B client island for /bookmarks. VISUAL RESKIN
// ONLY: the localStorage read/write, validation, catalogue intersection, the
// Remove control and the hydration/empty logic are all unchanged. Saved courses
// render in the shared .ccard grid with a top-right Remove (×); when nothing is
// saved (or pre-hydration) the warm dashed empty state shows alone.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Card, type CardProps } from '@/components/chrome/Card'
import { btnAccent, btnBase, cx } from '@/components/chrome/ui'

// Storage shape mirrors the comp's bookmarks.js: a JSON array of course
// codes (e.g. ["ACC201", "BUA203"]). We also accept slugs so a future
// "save" toggle on the course page can write whichever is most convenient.
const STORAGE_KEY = 'ci_bookmarks_v1'
// Same-tab sync signal shared with app/courses/[slug]/BookmarkButton.tsx, so
// removing here updates a bookmark button mounted elsewhere on the page.
const CHANGE_EVENT = 'ci:bookmarks-changed'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

export type BookmarkableCourse = {
  id: string
  code: string
  slug: string
  cardProps: CardProps
}

type Props = {
  catalog: ReadonlyArray<BookmarkableCourse>
}

type HydrationStatus = 'pending' | 'ready'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function BookmarksClient({ catalog }: Props) {
  const [status, setStatus] = useState<HydrationStatus>('pending')
  const [savedKeys, setSavedKeys] = useState<ReadonlyArray<string>>([])

  // Read on mount only. Anything thrown — JSON.parse failure, non-array
  // payload, mixed types — collapses to an empty set so the UI lands on the
  // empty state rather than a broken render.
  useEffect(() => {
    setSavedKeys(readSavedKeysSafe())
    setStatus('ready')
    // Stay in step if the set changes elsewhere (another tab, or a bookmark
    // button on this same document).
    const resync = () => setSavedKeys(readSavedKeysSafe())
    window.addEventListener('storage', resync)
    window.addEventListener(CHANGE_EVENT, resync)
    return () => {
      window.removeEventListener('storage', resync)
      window.removeEventListener(CHANGE_EVENT, resync)
    }
  }, [])

  // Remove a course from the saved set: drop both its slug and code (storage
  // accepts either form), persist, update the list in place, and notify any
  // bookmark button mounted on this document.
  const removeCourse = useCallback((course: BookmarkableCourse) => {
    const next = readSavedKeysSafe().filter(
      (k) => k !== course.slug && k !== course.code,
    )
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable — still drop it from the in-memory list below so
      // the UI responds to the click.
    }
    setSavedKeys(next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const byKey = new Map<string, BookmarkableCourse>()
  for (const c of catalog) {
    byKey.set(c.code, c)
    byKey.set(c.slug, c)
  }

  // Preserve storage order, dedupe, drop any unknown keys.
  const seen = new Set<string>()
  const matches: BookmarkableCourse[] = []
  for (const key of savedKeys) {
    const c = byKey.get(key)
    if (!c) continue
    if (seen.has(c.id)) continue
    seen.add(c.id)
    matches.push(c)
  }

  const count = matches.length
  const countLabel = pad2(count)
  // Treat the pre-hydration pass the same as "no bookmarks": render the empty
  // state alone. Avoids the SSR'd "00 Saved" cover flashing before the
  // localStorage read completes, and keeps the empty case a single clean block.
  const showEmpty = status !== 'ready' || count === 0

  if (showEmpty) {
    return (
      <section className="bg-ci-paper pb-20 pt-12 min-[900px]:pt-16" data-screen-label="Saved grid">
        <div className={WRAP}>
          <nav className="mb-10 flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-gray-500" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-ci-navy">Home</Link>
            <span className="text-ci-gray-400">/</span>
            <span className="text-ci-navy-900">Bookmarks</span>
          </nav>
          <div className="mx-auto max-w-[540px] rounded-[20px] border border-dashed border-ci-border-2 bg-ci-paper-2 p-[48px_28px] text-center">
            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">No saved files yet</div>
            <h3 className="mt-[14px] text-[26px] font-extrabold tracking-[-0.02em] text-ci-navy-900">Your bookmarks are empty</h3>
            <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-[1.55] text-ci-gray-600">
              Bookmark a course from its page and it lands here, ready for your next study run.
            </p>
            <div className="mt-6 inline-flex">
              <Link className={cx(btnBase, btnAccent)} href="/courses">
                Browse courses
              </Link>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <header
        className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ci-navy),var(--ci-navy-900))] text-white"
        data-screen-label="Cover"
      >
        <svg
          className="absolute right-[-60px] top-[-50px] z-0 h-[300px] w-[300px] text-ci-blue-600 opacity-50"
          viewBox="0 0 200 200"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
        </svg>
        <div className={`${WRAP} relative z-[1] pb-[42px] pt-[30px] min-[900px]:pb-[52px] min-[900px]:pt-10`}>
          <nav className="mb-[26px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-white">Home</Link>
            <span className="text-white/35">/</span>
            <span className="text-white">Bookmarks</span>
          </nav>
          <div className="flex items-baseline gap-[10px]">
            <span className="text-[clamp(46px,8vw,68px)] font-extrabold leading-[0.9] tracking-[-0.02em] text-ci-accent [font-variant-numeric:tabular-nums]">
              {countLabel}
            </span>
            <span className="text-[14px] font-semibold tracking-[0.04em] text-ci-blue-200">Saved</span>
          </div>
          <h1 className="mt-3 text-balance text-[clamp(36px,6.5vw,58px)] font-extrabold leading-none tracking-[-0.035em] text-white">
            Saved files
          </h1>
          <p className="mt-5 max-w-[54ch] text-[clamp(16px,2.1vw,19px)] leading-[1.5] text-ci-blue-150">
            Your shortlist of courses. Bookmarks are kept on this device, ready for the next study run.
          </p>
        </div>
      </header>

      <section className="bg-ci-paper pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Saved grid">
        <div className={WRAP}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[13.5px] font-medium text-ci-gray-600">
            <span>Saved to this device</span>
            <span className="[font-variant-numeric:tabular-nums]">
              {countLabel} {count === 1 ? 'file' : 'files'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-5 min-[680px]:grid-cols-2 min-[900px]:grid-cols-3 min-[900px]:gap-6">
            {matches.map((c) => (
              <Card
                key={c.id}
                {...c.cardProps}
                cornerAction={
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[16px] leading-none text-ci-gray-500 transition-colors hover:bg-r-50 hover:text-r-600"
                    onClick={() => removeCourse(c)}
                    aria-label={`Remove ${c.code} from bookmarks`}
                  >
                    <span aria-hidden="true">&times;</span>
                  </button>
                }
              />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

// Defensive read: anything malformed becomes []. Treat storage as untrusted
// since another tab, an extension, or a corrupted disk can mutate it.
function readSavedKeysSafe(): ReadonlyArray<string> {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0 && item.length < 64) {
        out.push(item)
      }
    }
    return out
  } catch {
    return []
  }
}
