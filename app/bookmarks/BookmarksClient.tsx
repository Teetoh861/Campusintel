// BookmarksClient — the saved grid for local or account-backed bookmarks.
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card, type CardProps } from '@/components/chrome/Card'
import { btnAccent, btnBase, cx } from '@/components/chrome/ui'
import { useBookmarks } from '@/lib/bookmarks/client'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

export type BookmarkableCourse = {
  id: string
  code: string
  slug: string
  contentKey: string
  cardProps: CardProps
}

type Props = {
  catalog: ReadonlyArray<BookmarkableCourse>
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function BookmarksClient({ catalog }: Props) {
  const { snapshot, remove, refresh } = useBookmarks(catalog)
  const [error, setError] = useState(false)

  const removeCourse = async (course: BookmarkableCourse) => {
    setError(false)
    if (!await remove(course)) setError(true)
  }

  const byKey = new Map<string, BookmarkableCourse>()
  for (const c of catalog) {
    byKey.set(c.code, c)
    byKey.set(c.slug, c)
  }

  // Preserve local order or server order, dedupe, and drop unknown local keys.
  const seen = new Set<string>()
  const matches: BookmarkableCourse[] = []
  for (const key of snapshot.keys) {
    const c = snapshot.mode === 'account'
      ? catalog.find(course => course.contentKey === key) : byKey.get(key)
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
  const showEmpty = snapshot.mode === 'loading' || snapshot.mode === 'unavailable' || count === 0

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
            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">
              {snapshot.mode === 'unavailable' ? 'Temporarily unavailable' : 'No saved files yet'}
            </div>
            <h3 className="mt-[14px] text-[26px] font-extrabold tracking-[-0.02em] text-ci-navy-900">
              {snapshot.mode === 'unavailable' ? 'Could not load bookmarks' : 'Your bookmarks are empty'}
            </h3>
            <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-[1.55] text-ci-gray-600">
              {snapshot.mode === 'unavailable'
                ? 'We could not check your saved courses. Please try again.'
                : 'Bookmark a course from its page and it lands here, ready for your next study run.'}
            </p>
            <div className="mt-6 inline-flex">
              {snapshot.mode === 'unavailable' ? (
                <button type="button" className={cx(btnBase, btnAccent)} onClick={() => { void refresh() }}>
                  Try again
                </button>
              ) : (
                <Link className={cx(btnBase, btnAccent)} href="/courses">Browse courses</Link>
              )}
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
            {snapshot.mode === 'local'
              ? 'Your shortlist of courses. Bookmarks are kept on this device, ready for the next study run.'
              : 'Your shortlist of courses. Bookmarks are saved to your account for the next study run.'}
          </p>
        </div>
      </header>

      <section className="bg-ci-paper pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Saved grid">
        <div className={WRAP}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[13.5px] font-medium text-ci-gray-600">
            <span>{snapshot.mode === 'local' ? 'Saved to this device' : 'Saved to your account'}</span>
            <span className="[font-variant-numeric:tabular-nums]">
              {countLabel} {count === 1 ? 'file' : 'files'}
            </span>
          </div>
          {error ? <p role="alert" className="mb-4 text-[14px] font-semibold text-r-600">
            Could not remove that bookmark. Try again.
          </p> : null}
          <div className="grid grid-cols-1 gap-5 min-[680px]:grid-cols-2 min-[900px]:grid-cols-3 min-[900px]:gap-6">
            {matches.map((c) => (
              <Card
                key={c.id}
                {...c.cardProps}
                cornerAction={
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-ci-border-2 bg-ci-white text-[24px] font-medium leading-none text-ci-gray-600 shadow-sm transition-[background-color,border-color,color,transform] hover:-translate-y-px hover:border-r-600 hover:bg-r-50 hover:text-r-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-r-600 focus-visible:ring-offset-2"
                    onClick={() => { void removeCourse(c) }}
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
