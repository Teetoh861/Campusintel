// components/student/StudentCourseRow.tsx — The one adapter from central StudentCourse truth to the shared course row.
import { getStudentCourseUnavailability, isActionableStudentCourse } from '@/lib/courses/read-model'
import { CourseRow } from './CourseRow'
import { getStudyFamilyLabels } from './study-families'
import type { StudentCourse } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

/** Present actionability, canonical route and study labels without reconstructing any of them. */
export function StudentCourseRow({ course }: { course: StudentCourse }): ReactElement {
  if (!isActionableStudentCourse(course)) {
    return <CourseRow code={course.code} title={course.title}
      unavailable={getStudentCourseUnavailability(course) ?? 'temporary'} />
  }
  return <CourseRow code={course.code} title={course.title}
    href={course.repository.route.href} learningTypes={getStudyFamilyLabels(course.content.study)} />
}
