// Inert Student App loading boundary for the institutional catalogue.
import { CourseRegister } from '@/components/student/CourseRow'
import { PageBand } from '@/components/student/PageBand'
import { Skeleton } from '@/components/ui/skeleton'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { CATALOGUE_LEDE, COURSES_PER_PAGE } from './catalogue-presentation'

/** Announce loading without exposing unverified identities or offering placeholder actions. */
export default function Loading() {
  return <div className="student-register-page" data-student-app>
    <PageBand title={STUDENT_DESTINATIONS.courses.label} lede={CATALOGUE_LEDE}
      context={<p>Institutional course catalogue</p>} />
    <div className="student-workspace student-register-workspace" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading institutional courses.</span>
      <div aria-hidden="true">
        <CourseRegister label="Course placeholders">
          {Array.from({ length: COURSES_PER_PAGE }, (_, index) => <div key={index} className="student-course-row">
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
