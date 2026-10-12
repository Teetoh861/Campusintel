// app/courses/[slug]/loading.tsx — Inert loading boundary without unverified course identity.
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'
import { COURSE_LEDE } from './sections'
import type { ReactElement } from 'react'

const PLACEHOLDER_SECTIONS = 3

/** Never show a placeholder code, title, bookmark or practice action while the course resolves. */
export default function Loading(): ReactElement {
  return <StudentPage band={<PageBand title="Course" lede={COURSE_LEDE}
    context={<Skeleton aria-hidden="true" className="h-4 w-24 animate-none" />} />}>
    <StudentLoadingState message="Loading course.">
      <div className="student-stack">
        {Array.from({ length: PLACEHOLDER_SECTIONS }, (_, index) => <div key={index} className="student-surface">
          <Skeleton className="h-5 w-2/5 animate-none" />
          <Skeleton className="mt-3 h-4 w-full animate-none" />
          <Skeleton className="mt-2 h-4 w-4/5 animate-none" />
        </div>)}
      </div>
    </StudentLoadingState>
  </StudentPage>
}
