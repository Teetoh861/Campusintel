// app/courses/page.tsx — Account-gated directory resolved from published managed content.
import { TaskHeader } from '@/components/chrome/TaskHeader'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { Feedback } from '@/components/chrome/Feedback'
import { courses } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedCourse } from '@/lib/managed-content/published'
import { getUsableManagedQuiz } from '@/lib/managed-content/quiz'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import { CourseDirectory } from './CourseDirectory'
import type { Course } from '@/lib/types'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import type { DirectoryItem } from './CourseDirectory'
import type { ReactElement } from 'react'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

async function buildItems(all: ReadonlyArray<Course>): Promise<DirectoryItem[] | null> {
  const resolved = await Promise.all(all.map(async course => {
    const published = await getPublishedManagedCourse(course.contentKey)
    if (published.status !== 'ok') return null
    const projected = projectStudentLearning(published.content)
    if (projected.status !== 'ok') return null
    return { course, learning: projected.learning }
  }))
  if (resolved.some(entry => entry === null)) return null
  return resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null).map(({ course, learning }) => {
    const quiz = getUsableManagedQuiz(course.slug,
      getQuizConfigurationByCourseSlug(course.slug), learning.quizQuestions)
    const critical = course.examCritical === true
    const cardProps: CardProps = {
      code: course.code,
      title: course.title,
      // Punchy tagline where set; otherwise the real overview (clamped in Card).
      desc: course.tagline ?? learning.overview?.body,
      // Exam-critical courses keep their View course action even when a quiz
      // attempt is unavailable.
      flag: critical
        ? { kind: 'critical', label: 'Exam-critical' }
        : { kind: 'tracked', label: 'Tracked' },
      level: String(course.level),
      credits: `${course.credits} credits`,
      questions: quiz ? String(quiz.bankSize) : undefined,
      timeLimit: quiz ? `${quiz.timerSeconds / 60} min` : '',
      difficulty: toLevel(course.difficulty),
      cta: {
        label: 'View course',
        href: `/courses/${course.slug}`,
        variant: 'primary',
        withArrow: true,
      },
      secondaryCta: critical && quiz
        ? {
            label: 'Start quiz',
            href: quiz.href,
            variant: 'secondary',
            withArrow: true,
          }
        : undefined,
    }
    return {
      id: course.id,
      cardProps,
      filter: {
        code: course.code,
        title: course.title,
        level: course.level,
        semester: course.semester,
        difficulty: course.difficulty,
      },
    }
  })
}

/** Cross the student account boundary before the course directory renders. */
export default function CoursesPage(): ReactElement {
  return <StudentAccessGate returnPath="/courses"><CourseDirectoryPage /></StudentAccessGate>
}

async function CourseDirectoryPage(): Promise<ReactElement> {
  const items = await buildItems(courses)
  if (items === null) return <Feedback message="Course content is temporarily unavailable." tone="error" />
  const totalCount = courses.length
  const countLabel = String(totalCount).padStart(2, '0')

  return (
    <>
      <TaskHeader label="Index header" title="Course directory"
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Courses' }]}
        description="Every course we have decoded, in one place. Search a code or title, or filter by level, semester and difficulty."
        count={`${countLabel} courses`}
        meta="Now serving Business Administration · 200 Level · First and Second Semester" />

      <CourseDirectory items={items} totalCount={totalCount} />
    </>
  )
}
