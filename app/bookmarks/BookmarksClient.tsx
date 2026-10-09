// app/bookmarks/BookmarksClient.tsx — Stable loading, empty and saved presentations for the existing store.
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card } from '@/components/chrome/Card'
import { TaskHeader } from '@/components/chrome/TaskHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { BookmarkToggle } from '@/components/student/BookmarkToggle'
import { btnAccent, btnBase, cx } from '@/components/chrome/ui'
import { useBookmarks } from '@/lib/bookmarks/client'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { CardProps } from '@/components/chrome/Card'
import type { ReactElement } from 'react'

const WRAP = 'app-container student-workspace'

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

/** Present saved courses honestly while account-backed bookmarks load. */
export function BookmarksClient({ catalog }: Props): ReactElement {
  const { snapshot, toggle, refresh } = useBookmarks(catalog)
  const [error, setError] = useState(false)

  const toggleCourse = async (course: BookmarkableCourse) => {
    setError(false)
    if (await toggle(course) === null) setError(true)
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
  const loading = snapshot.mode === 'loading'
  const unavailable = snapshot.mode === 'unavailable'

  return <div data-student-app>
    <TaskHeader label="Cover" title={STUDENT_DESTINATIONS.bookmarks.label}
      crumbs={[{ label: 'Dashboard', href: STUDENT_DESTINATIONS.dashboard.href }, { label: STUDENT_DESTINATIONS.bookmarks.label }]}
      count={loading || unavailable ? undefined : `${countLabel} bookmarks`}
      description={snapshot.mode === 'local'
        ? 'Your shortlist of courses. Bookmarks are kept on this device, ready for the next study run.'
        : 'Your shortlist of courses. Bookmarks are saved to your account for the next study run.'} />
    <section className="student-page" data-screen-label="Saved grid">
      <div className={WRAP}>
        {loading ? <>
          <p role="status" className="student-meta mb-4">Loading your saved courses…</p>
          <div className="student-grid" aria-hidden="true">
            {[0, 1, 2].map(index => <Skeleton key={index}
              className="h-44 rounded-ci-card bg-student-skeleton motion-reduce:animate-none" />)}
          </div>
        </> : unavailable || count === 0 ?
          <div className="student-surface mx-auto max-w-[540px] text-center">
            <div className="student-meta font-semibold">
              {unavailable ? 'Temporarily unavailable' : 'No bookmarks yet'}
            </div>
            <h2 className="student-section-title mt-3">
              {unavailable ? 'Could not load bookmarks' : 'Your bookmarks are empty'}
            </h2>
            <p className="student-meta mx-auto mt-3 max-w-[42ch]">
              {unavailable ? 'We could not check your saved courses. Please try again.'
                : 'Bookmark a course from its page and it lands here, ready for your next study run.'}
            </p>
            <div className="mt-5 inline-flex">
              {unavailable ? <button type="button" className={cx(btnBase, btnAccent)}
                onClick={() => { void refresh() }}>Try again</button>
                : <Link className={cx(btnBase, btnAccent)} href="/courses">Browse courses</Link>}
            </div>
          </div> : <>
            <p className="student-meta mb-4">{snapshot.mode === 'local' ? 'Saved to this device' : 'Saved to your account'}</p>
            {error && <p role="alert" className="mb-4 text-sm font-semibold text-student-error">
              Could not update that bookmark. Try again.
            </p>}
            <div className="student-grid">
              {matches.map(course => <Card key={course.id} {...course.cardProps}
                cornerAction={<BookmarkToggle pressed label={`Bookmark ${course.code}`}
                  onClick={() => { void toggleCourse(course) }} />} />)}
            </div>
          </>}
      </div>
    </section>
  </div>
}
