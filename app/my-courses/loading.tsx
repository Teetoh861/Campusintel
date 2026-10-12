// app/my-courses/loading.tsx — Inert register skeleton without private academic context.
import { CourseRegisterSkeleton } from '@/components/student/CourseRegisterSkeleton'
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement } from 'react'

const REGISTER_ROWS = 6

/** Announce loading while keeping student identity and unverified course data out of the boundary. */
export default function Loading(): ReactElement {
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.myCourses.label} lede="Your semester, in one place."
    context={<Skeleton aria-hidden="true" className="h-4 w-4/5 max-w-96 animate-none" />}
    aside={<Skeleton aria-hidden="true" className="h-11 w-40 max-w-full animate-none" />} />}>
    <StudentLoadingState message="Loading your semester courses.">
      <CourseRegisterSkeleton rows={REGISTER_ROWS} />
    </StudentLoadingState>
  </StudentPage>
}
