// app/bookmarks/page.tsx — Account-gated bookmark register: central course truth composed over the shared bookmark store.
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { presentStudentCourseRow } from '@/components/student/StudentCourseRow'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { courses } from '@/lib/data/courses'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { BookmarksClient } from './BookmarksClient'
import { BOOKMARKS_LEDE } from './presentation'
import type { RepositoryOnlyCourse, RoutedStudentCourse } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

const BOOKMARKS_PATH = STUDENT_DESTINATIONS.bookmarks.href

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Bookmarks | CampusIntell', robots: { index: false, follow: false } }

/** Cross the student account boundary before any bookmark state renders. */
export default function BookmarksPage(): ReactElement {
  return <StudentAccessGate returnPath={BOOKMARKS_PATH}><Bookmarks /></StudentAccessGate>
}

/** Preload the bookmarkable shelf through the central model; the client maps the live snapshot onto it. */
async function Bookmarks(): Promise<ReactElement> {
  let result: { status: 'ok'; courses: (RoutedStudentCourse | RepositoryOnlyCourse)[] }
    | { status: 'signed-out' | 'unavailable' | 'invariant-failure' }
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    if (context === null) result = { status: 'signed-out' }
    else {
      // The small shelf bounds this preload. The existing route reader owns both institutional
      // and repository-only truth; saved courses are independent of the current academic selection.
      const lookups = await Promise.all(courses.map(course => getStudentCourseBySlugForVerifiedStudent(client, course.slug)))
      const resolved: (RoutedStudentCourse | RepositoryOnlyCourse)[] = []
      result = { status: 'ok', courses: resolved }
      if (lookups.some(lookup => lookup.status === 'signed-out')) result = { status: 'signed-out' }
      else for (const lookup of lookups) {
        if (lookup.status === 'ok' || lookup.status === 'repository-only') resolved.push(lookup.course)
        else if (lookup.status !== 'not-found') { result = { status: lookup.status }; break }
      }
    }
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'signed-out') redirectForStudentState('signed-out', BOOKMARKS_PATH)
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.bookmarks.label} lede={BOOKMARKS_LEDE} />}>
    {result.status === 'ok'
      ? <BookmarksClient catalog={result.courses.map(course => ({
        // Legacy device aliases come from the shelved route; presentation comes from the shared adapter.
        slug: course.repository.route.slug, code: course.repository.route.course.code,
        contentKey: course.repository.contentKey, row: presentStudentCourseRow(course),
      }))} />
      : <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'courses-unavailable'}
        retryHref={BOOKMARKS_PATH} />}
  </StudentPage>
}
