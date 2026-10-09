// app/my-courses/loading.tsx — Inert PageBand/register skeleton without private academic context.
import { CourseRegister } from '@/components/student/CourseRow'
import { PageBand } from '@/components/student/PageBand'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactElement } from 'react'

/** Announce loading while keeping student identity and unverified course data out of the boundary. */
export default function Loading(): ReactElement {
  return <div className="student-register-page" data-student-app>
    <PageBand title="My Courses" lede="Your semester, in one place."
      context={<Skeleton aria-hidden="true" className="h-4 w-4/5 max-w-96 animate-none" />}
      aside={<Skeleton aria-hidden="true" className="h-11 w-40 max-w-full animate-none" />} />
    <div className="student-workspace student-register-workspace" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your semester courses.</span>
      <div aria-hidden="true">
        <CourseRegister label="Course placeholders">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="student-course-row">
            <div className="student-course-row-body">
              <Skeleton className="h-3 w-16 animate-none" />
              <Skeleton className="mt-1 h-5 w-4/5 animate-none" />
              <Skeleton className="mt-2 h-3 w-2/5 animate-none" />
            </div>
          </div>)}
        </CourseRegister>
      </div>
    </div>
  </div>
}
