// components/student/StudentCourseRow.tsx — The one adapter from central course truth to the shared course row.
import { getStudentCourseUnavailability, isActionableStudentCourse, isInstitutionalStudentCourse,
  isLockedStudentCourse } from '@/lib/courses/read-model'
import { isAiPracticeAvailable } from '@/lib/ai-practice/config'
import { aiPracticePath } from '@/lib/ai-practice/routes'
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
  if (isLockedStudentCourse(course)) return { ...identity, href: course.repository.route.href, locked: true,
    ...(course.content.reason ? { lockReason: course.content.reason } : {}) }
  if (!isActionableStudentCourse(course)) {
    const reason = getStudentCourseUnavailability(course)
    const unavailable = reason === 'missing' ? 'missing' : 'temporary'
    // PRD 4.3: an institutional course with no built content offers the secondary, personal AI path.
    const aiPracticeHref = unavailable === 'missing' && isInstitutionalStudentCourse(course) && isAiPracticeAvailable()
      ? aiPracticePath(course.institutionalCourseId) : undefined
    return { ...identity, unavailable, ...(aiPracticeHref ? { aiPracticeHref } : {}) }
  }
  return { ...identity, href: course.repository.route.href, learningTypes: getStudyFamilyLabels(course.content.study) }
}

/** Present actionability, canonical route and study labels without reconstructing any of them. */
export function StudentCourseRow({ course, progress, trailingAction }: {
  course: PresentableStudentCourse
  progress?: string
  trailingAction?: ReactNode
}): ReactElement {
  return <CourseRow {...presentStudentCourseRow(course)} progress={progress} trailingAction={trailingAction} />
}
