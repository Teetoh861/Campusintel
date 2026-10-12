// Inert Student App loading boundary for the institutional catalogue.
import { CourseRegisterSkeleton } from '@/components/student/CourseRegisterSkeleton'
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { CATALOGUE_CONTEXT, CATALOGUE_LEDE, COURSES_PER_PAGE } from './catalogue-presentation'

/** Announce loading without exposing unverified identities or offering placeholder actions. */
export default function Loading() {
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.courses.label} lede={CATALOGUE_LEDE}
    context={<p>{CATALOGUE_CONTEXT}</p>} />}>
    <StudentLoadingState message="Loading institutional courses.">
      <CourseRegisterSkeleton rows={COURSES_PER_PAGE} />
    </StudentLoadingState>
  </StudentPage>
}
