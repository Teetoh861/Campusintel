// app/bookmarks/BookmarksClient.tsx — The bookmark register over the shared store: snapshot order, ten per page, confirmed removal only.
'use client'

import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { BookmarkFeedback, useBookmarkFeedback } from '@/components/student/BookmarkFeedback'
import { BookmarkToggle } from '@/components/student/BookmarkToggle'
import { CourseRegisterSkeleton } from '@/components/student/CourseRegisterSkeleton'
import { CourseRegister, CourseRow } from '@/components/student/CourseRow'
import { EmptyState } from '@/components/student/EmptyState'
import { Notice } from '@/components/student/Notice'
import { Pagination } from '@/components/student/Pagination'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { studentAction, studentFocusControl, studentFocusDark } from '@/components/student/ui'
import { useBookmarks } from '@/lib/bookmarks/client'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { BOOKMARKS_LOADING_MESSAGE, BOOKMARKS_PER_PAGE } from './presentation'
import type { CourseRowPresentation } from '@/components/student/CourseRow'
import type { BookmarkCourseAlias, BookmarkSnapshot } from '@/lib/bookmarks/contract'
import type { ReactElement } from 'react'

/** Legacy device aliases plus the central row presentation; the page derives no course truth itself. */
export type BookmarkableCourse = BookmarkCourseAlias & { row: CourseRowPresentation }

// Stable snapshot neighbors survive refills, clamping and intervening store updates.
type FocusRequest = { kind: 'after-removal'; next: string[]; previous: string[] }
  | { kind: 'retain'; contentKey: string }

/** Snapshot order, deduplicated: account keys are content keys, legacy device keys are slugs or codes. */
function orderBookmarks(snapshot: BookmarkSnapshot, catalog: ReadonlyArray<BookmarkableCourse>): BookmarkableCourse[] {
  const byKey = new Map<string, BookmarkableCourse>()
  const byAlias = new Map<string, BookmarkableCourse>()
  for (const course of catalog) {
    byKey.set(course.contentKey, course)
    byAlias.set(course.slug, course)
    byAlias.set(course.code, course)
  }
  const seen = new Set<string>()
  const ordered: BookmarkableCourse[] = []
  for (const key of snapshot.keys) {
    const course = snapshot.mode === 'account' ? byKey.get(key) : byAlias.get(key)
    if (!course || seen.has(course.contentKey)) continue
    seen.add(course.contentKey)
    ordered.push(course)
  }
  return ordered
}

/** Render only confirmed store state; the row stays, pressed and busy, until removal is confirmed. */
export function BookmarksClient({ catalog }: { catalog: ReadonlyArray<BookmarkableCourse> }): ReactElement {
  const { snapshot, remove, refresh } = useBookmarks(catalog)
  const [feedback, showFeedback] = useBookmarkFeedback()
  const [requestedPage, setPage] = useState(1)
  const [pending, setPending] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const pendingKey = useRef<string | null>(null)
  const toggles = useRef(new Map<string, HTMLButtonElement>())
  const emptyHeading = useRef<HTMLHeadingElement>(null)
  const head = useRef<HTMLDivElement>(null)

  const ordered = orderBookmarks(snapshot, catalog)
  const total = ordered.length
  const totalPages = Math.ceil(total / BOOKMARKS_PER_PAGE)
  const page = Math.min(requestedPage, Math.max(1, totalPages))
  // Clamp before slicing as well as settling state, so a shrinking set never flashes an empty page.
  useEffect(() => { if (requestedPage !== page) setPage(page) }, [page, requestedPage])
  const start = (page - 1) * BOOKMARKS_PER_PAGE
  const visible = ordered.slice(start, start + BOOKMARKS_PER_PAGE)
  const loading = snapshot.mode === 'loading'
  const unavailable = snapshot.mode === 'unavailable'
  const ready = !loading && !unavailable

  useEffect(() => {
    if (focusRequest === null || !ready || pending !== null) return
    // Logical identity chooses the page first; attached refs are only the final focus destination.
    const remaining = new Set(ordered.map(course => course.contentKey))
    const key = focusRequest.kind === 'retain' ? focusRequest.contentKey
      : [...focusRequest.next, ...focusRequest.previous].find(candidate => remaining.has(candidate))
    let target: HTMLButtonElement | HTMLHeadingElement | null | undefined
    if (key === undefined) {
      if (total !== 0 || focusRequest.kind === 'retain') return
      target = emptyHeading.current
    } else {
      const index = ordered.findIndex(course => course.contentKey === key)
      if (index < 0) return
      const targetPage = Math.floor(index / BOOKMARKS_PER_PAGE) + 1
      if (page !== targetPage) { setPage(targetPage); return }
      target = toggles.current.get(key)
    }
    if (!target?.isConnected || ('disabled' in target && target.disabled)) return
    target.focus()
    if (target.ownerDocument.activeElement === target) setFocusRequest(null)
  }, [focusRequest, ordered, page, pending, ready, total])

  const removeBookmark = async (course: BookmarkableCourse) => {
    if (pendingKey.current !== null) return
    const index = ordered.findIndex(item => item.contentKey === course.contentKey)
    const neighbors: FocusRequest = { kind: 'after-removal',
      next: ordered.slice(index + 1).map(item => item.contentKey),
      previous: ordered.slice(0, index).reverse().map(item => item.contentKey) }
    pendingKey.current = course.contentKey
    const initiatingToggle = toggles.current.get(course.contentKey)
    const activeElement = initiatingToggle?.ownerDocument.activeElement
    // Move focus off another toggle before global serialization disables it.
    if ([...toggles.current.values()].some(toggle => toggle !== initiatingToggle && toggle === activeElement)) {
      initiatingToggle?.focus()
    }
    setPending(course.contentKey)
    setFocusRequest(null)
    showFeedback(null)
    let removed = false
    try { removed = await remove(course) }
    catch { /* A rejected transport is the same failed mutation; confirmed state stays authoritative. */ }
    finally {
      pendingKey.current = null
      setPending(null)
    }
    showFeedback(removed ? 'removed' : 'error')
    setFocusRequest(removed ? neighbors : { kind: 'retain', contentKey: course.contentKey })
  }

  const retry = () => {
    showFeedback(null)
    void refresh()
  }

  const populated = (ready && total > 0) || feedback !== null
  return <div className="student-bookmarks">
    <div ref={head} tabIndex={-1} className={'student-bookmarks-head ' + studentFocusControl} data-populated={populated}>
      {ready && populated && <h2 className="student-bookmarks-count">{total} {total === 1 ? 'course' : 'courses'}</h2>}
      <BookmarkFeedback state={feedback} onDismiss={() => showFeedback(null)} />
    </div>
    {loading && <StudentLoadingState message={BOOKMARKS_LOADING_MESSAGE}>
      <CourseRegisterSkeleton rows={BOOKMARKS_PER_PAGE} columns="single" />
    </StudentLoadingState>}
    {unavailable && <Notice title="Bookmarks temporarily unavailable" action={
      <button type="button" className={studentAction(btnGhost, 'bg-student-surface')} onClick={retry}>Try again</button>
    }>We couldn’t load your bookmarks just now. Try again to see your latest bookmarks.</Notice>}
    {ready && total === 0 && <EmptyState headingRef={emptyHeading} title="You haven’t bookmarked any courses yet."
      icon={<Bookmark aria-hidden="true" size={22} strokeWidth={1.75} />} actions={<>
        <Link href={STUDENT_DESTINATIONS.courses.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
          Browse {STUDENT_DESTINATIONS.courses.label}
        </Link>
        <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false} className={studentAction(btnGhost)}>
          {STUDENT_DESTINATIONS.myCourses.label}
        </Link>
      </>}>
      Bookmark a course from {STUDENT_DESTINATIONS.courses.label} or its course page and it will appear here.
    </EmptyState>}
    {ready && total > 0 && <>
      <CourseRegister label="Bookmarked courses" columns="single">
        {visible.map(course => <CourseRow key={course.contentKey} {...course.row}
          trailingAction={<BookmarkToggle pressed busy={pending === course.contentKey} label={`Bookmark ${course.row.title}`}
            disabled={pending !== null && pending !== course.contentKey}
            ref={node => {
              if (node) toggles.current.set(course.contentKey, node)
              else toggles.current.delete(course.contentKey)
            }}
            onClick={() => { void removeBookmark(course) }} />} />)}
      </CourseRegister>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} label="Bookmarks pages" scrollTarget={head} />
    </>}
  </div>
}
