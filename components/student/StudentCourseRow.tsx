// components/student/StudentCourseRow.tsx — The one adapter from central course truth to the shared course row.
import { getStudentCourseUnavailability, isActionableStudentCourse, isInstitutionalStudentCourse,
  isLockedStudentCourse } from '@/lib/courses/read-model'
import { aiPracticePath } from '@/lib/ai-practice/routes'
import { CourseRow } from './CourseRow'
import { getStudyFamilyLabels } from './study-families'
import { accessCopy } from '@/lib/entitlements/presentation'
import type { CourseRowIdentity, CourseRowPresentation } from './CourseRow'
import type { PresentableStudentCourse } from '@/lib/courses/read-model'
import type { ReactElement, ReactNode } from 'react'

/** Derive the serializable row presentation: identity, actionability, canonical route and study labels. */
export function presentStudentCourseRow(course: PresentableStudentCourse,
  { plansOnSale = false, campusBotLinks }: { plansOnSale?: boolean; campusBotLinks?: ReadonlySet<string> } = {}):
  CourseRowPresentation {
  // A repository-only identity never gains an institutional code; its title is the shelved route's.
  const identity: CourseRowIdentity = isInstitutionalStudentCourse(course)
    ? { code: course.code, title: course.title }
    : { repositoryOnly: true, title: course.repository.route.course.title }
  if (isLockedStudentCourse(course)) return { ...identity, href: course.repository.route.href, locked: true,
    ...(course.content.reason ? { lockReason: course.content.reason } : {}),
    ...(plansOnSale ? { lockedLabel: accessCopy(true).studyLocked } : {}) }
  if (!isActionableStudentCourse(course)) {
    const reason = getStudentCourseUnavailability(course)
    const unavailable = reason === 'missing' ? 'missing' : 'temporary'
    // Prefer the course page; without one, link only where Campus Bot opens for this student.
    const href = unavailable !== 'missing' ? undefined : course.repository.state === 'shelved'
      ? course.repository.route.href : isInstitutionalStudentCourse(course) && campusBotLinks?.has(course.institutionalCourseId)
        ? aiPracticePath(course.institutionalCourseId) : undefined
    return { ...identity, unavailable, ...(href ? { href } : {}) }
  }
  return { ...identity, href: course.repository.route.href, learningTypes: getStudyFamilyLabels(course.content.study) }
}

/** Present actionability, canonical route and study labels without reconstructing any of them. */
export function StudentCourseRow({ course, progress, trailingAction, plansOnSale = false, campusBotLinks }: {
  course: PresentableStudentCourse
  progress?: string
  trailingAction?: ReactNode
  /** The copy switch (plans_on_sale). */
  plansOnSale?: boolean
  /** The courses where Campus Bot opens for this student (readCampusBotLinks). */
  campusBotLinks?: ReadonlySet<string>
}): ReactElement {
  return <CourseRow {...presentStudentCourseRow(course, { plansOnSale, campusBotLinks })} progress={progress}
    trailingAction={trailingAction} />
}
