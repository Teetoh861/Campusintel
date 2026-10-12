// Server presentation of authoritative Student Course actionability and study labels.
import { CourseRow } from '@/components/student/CourseRow'
import { getStudentCourseUnavailability, isActionableStudentCourse } from '@/lib/courses/read-model'
import type { StudentCourse } from '@/lib/courses/read-model'

/** Present central truth without reconstructing publication or route capability. */
export function CourseResult({ course }: { course: StudentCourse }) {
  if (!isActionableStudentCourse(course)) return <CourseRow code={course.code} title={course.title}
    unavailable={getStudentCourseUnavailability(course) ?? 'temporary'} />
  const { study } = course.content
  const learningTypes = [
    study.notes && 'Notes',
    study.cbtPractice && 'CBT practice',
    study.theory && 'Theory',
  ].filter((label): label is string => Boolean(label))
  return <CourseRow code={course.code} title={course.title}
    href={course.repository.route.href} learningTypes={learningTypes} />
}
