// app/bookmarks/loading.tsx — Inert single-column register skeleton while the shelf and gate resolve.
import { CourseRegisterSkeleton } from '@/components/student/CourseRegisterSkeleton'
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { BOOKMARKS_LEDE, BOOKMARKS_LOADING_MESSAGE, BOOKMARKS_PER_PAGE } from './presentation'
import type { ReactElement } from 'react'

/** Announce loading once, with the same geometry the live register uses, and no placeholder controls. */
export default function Loading(): ReactElement {
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.bookmarks.label} lede={BOOKMARKS_LEDE} />}>
    <div className="student-bookmarks">
      <StudentLoadingState message={BOOKMARKS_LOADING_MESSAGE}>
        <CourseRegisterSkeleton rows={BOOKMARKS_PER_PAGE} columns="single" />
      </StudentLoadingState>
    </div>
  </StudentPage>
}
