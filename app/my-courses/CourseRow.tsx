// app/my-courses/CourseRow.tsx — Map published semester-course state to the shared Student App row.
import { CourseRow as StudentCourseRow } from '@/components/student/CourseRow'
import type { ReactElement } from 'react'
import type { DashboardCourse } from '@/lib/dashboard/current-student-courses'

/** Translate authoritative availability without adding content, links or student progress. */
export function CourseRow({ course }: { course: DashboardCourse }): ReactElement {
  const { code, title, content } = course
  if (content.state !== 'ready') return <StudentCourseRow code={code} title={title}
    unavailable={content.state === 'not-built' || content.state === 'no-learning' ? 'missing' : 'temporary'} />
  const learningTypes = [
    content.availability.overview && 'Notes',
    content.availability.theory && 'Theory',
    content.availability.quiz && 'CBT practice',
  ].filter((label): label is string => Boolean(label))
  return <StudentCourseRow code={code} title={title} href={content.courseHref} learningTypes={learningTypes} />
}
