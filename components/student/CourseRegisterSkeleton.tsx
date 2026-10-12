// components/student/CourseRegisterSkeleton.tsx — Placeholder rows in the shared course register shape.
import { Skeleton } from '@/components/ui/skeleton'
import { CourseRegister } from './CourseRow'
import type { ReactElement } from 'react'

/** Inert course rows for register loading states; no identity, no actions. */
export function CourseRegisterSkeleton({ rows }: { rows: number }): ReactElement {
  return <CourseRegister label="Course placeholders">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="student-course-row">
      <div className="student-course-row-body">
        <Skeleton className="h-3 w-16 animate-none" />
        <Skeleton className="mt-1 h-5 w-4/5 animate-none" />
        <Skeleton className="mt-2 h-3 w-2/5 animate-none" />
      </div>
    </div>)}
  </CourseRegister>
}
