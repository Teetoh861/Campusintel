// components/student/StudentCourseRow.tsx — The one adapter from central course truth to the shared course row.
import { getStudentCourseUnavailability, isActionableStudentCourse, isInstitutionalStudentCourse }
  from '@/lib/courses/read-model'
import { CourseRow } from './CourseRow'
import { getStudyFamilyLabels } from './study-families'
import type { CourseRowIdentity, CourseRowPresentation } from './CourseRow'
import type { PresentableStudentCourse } from '@/lib/courses/read-model'
import type { ReactElement, ReactNode } from 'react'

/** Derive the serializable row presentation: identity, actionability, canonical route and study labels. */
export function presentStudentCourseRow(course: PresentableStudentCourse): CourseRowPresentation {
  // A repository-only identity never gains an institutional code; its title is the shelved route's.
  const identity: CourseRowIdentity = isInstitutionalStudentCourse(course)
    ? { code: course.code, title: course.title }
    : { repositoryOnly: true, title: course.repository.route.course.title }
  if (!isActionableStudentCourse(course)) {
    return { ...identity, unavailable: getStudentCourseUnavailability(course) ?? 'temporary' }
  }
  return { ...identity, href: course.repository.route.href, learningTypes: getStudyFamilyLabels(course.content.study) }
}

/** Present actionability, canonical route and study labels without reconstructing any of them. */
export function StudentCourseRow({ course, trailingAction }: {
  course: PresentableStudentCourse
  trailingAction?: ReactNode
}): ReactElement {
  return <CourseRow {...presentStudentCourseRow(course)} trailingAction={trailingAction} />
}
