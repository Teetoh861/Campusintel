// app/my-courses/CourseRow.tsx — Map central Student Course truth to the shared Student App row.
import { CourseRow as StudentCourseRow } from '@/components/student/CourseRow'
import { getStudentCourseUnavailability, isActionableStudentCourse } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'
import type { StudentCourse } from '@/lib/courses/read-model'

/** Translate authoritative availability without adding content, links or student progress. */
export function CourseRow({ course }: { course: StudentCourse }): ReactElement {
  const { code, title } = course
  if (!isActionableStudentCourse(course)) {
    return <StudentCourseRow code={code} title={title}
      unavailable={getStudentCourseUnavailability(course) === 'missing' ? 'missing' : 'temporary'} />
  }
  const { study } = course.content
  const learningTypes = [
    study.notes && 'Notes',
    study.theory && 'Theory',
    study.cbtPractice && 'CBT practice',
  ].filter((label): label is string => Boolean(label))
  return <StudentCourseRow code={code} title={title} href={course.repository.route.href} learningTypes={learningTypes} />
}
