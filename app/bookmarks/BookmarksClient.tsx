// BookmarksClient — the client island for /bookmarks. Reads the locally
// saved set from localStorage on mount, validates the payload, intersects
// it with the known catalogue, and renders the matches as Card components
// in the homepage / directory grid. When nothing's saved (or before mount,
// when localStorage hasn't been read yet) the dossier empty state shows.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { Card, type CardProps } from '@/components/chrome/Card'

// Storage shape mirrors the comp's bookmarks.js: a JSON array of course
// codes (e.g. ["ACC201", "BUA203"]). We also accept slugs so a future
// "save" toggle on the course page can write whichever is most convenient.
const STORAGE_KEY = 'ci_bookmarks_v1'
// Same-tab sync signal shared with app/courses/[slug]/BookmarkButton.tsx, so
// removing here updates a bookmark button mounted elsewhere on the page.
const CHANGE_EVENT = 'ci:bookmarks-changed'

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

const fileIndex = (i: number) => `File ${pad2(i + 1)}`

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
  // Treat the pre-hydration pass the same as "no bookmarks": render the
  // dossier empty state alone. Avoids the SSR'd "00 Saved" cover that the
  // user would see flash before the localStorage read completes, and means
  // the empty case is always a single clean block — no stacked redundancy
  // between cover count and empty-state heading.
  const showEmpty = status !== 'ready' || count === 0

  if (showEmpty) {
    return (
      <section className="pg-body" data-screen-label="Saved grid">
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span className="cur">Bookmarks</span>
          </nav>
          <div className="dir-empty ticks show">
            <div className="de-mark">No saved files yet</div>
            <h3>Your bookmarks are empty</h3>
            <p>
              Bookmark a course from its file and it lands here, ready for
              your next study run.
            </p>
            <div className="de-cta">
              <Link className="btn btn-primary" href="/courses">
                Browse courses <span className="arrow">&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span className="cur">Bookmarks</span>
          </nav>
          <div className="dir-count">
            <span className="num">{countLabel}</span>
            <span className="lab">Saved</span>
          </div>
          <h1 className="dir-title">Saved Files</h1>
          <p className="dir-lede">
            Your shortlist of intelligence files. Bookmarked courses stay here
            on this device, ready for the next study run.
          </p>
        </div>
      </header>

      <section className="pg-body" data-screen-label="Saved grid">
        <div className="wrap">
          <div className="bm-headrow">
            <span className="bm-h">Saved to this device</span>
            <span className="bm-h">
              {countLabel} {count === 1 ? 'file' : 'files'}
            </span>
          </div>
          <div className="course-grid">
            {matches.map((c, i) => (
              <Card
                key={c.id}
                {...c.cardProps}
                intelIndex={fileIndex(i)}
                footerAction={
                  <button
                    type="button"
                    className="bm-unsave"
                    onClick={() => removeCourse(c)}
                    aria-label={`Remove ${c.code} from bookmarks`}
                  >
                    <span className="x" aria-hidden="true">
                      ✕
                    </span>{' '}
                    Remove
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
