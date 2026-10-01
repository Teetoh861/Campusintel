// Bookmarks (/bookmarks) — account-gated course cards with a client island
// that reads account-backed state from the live student session.
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { courses } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getUsableCourseQuiz } from '@/lib/data/quiz-availability'
import type { Course } from '@/lib/types'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import {
  BookmarksClient,
  type BookmarkableCourse,
} from './BookmarksClient'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

function buildCardProps(course: Course): CardProps {
  const quiz = getUsableCourseQuiz(course, getQuizByCourseSlug(course.slug))
  const critical = course.examCritical === true
  return {
    code: course.code,
    title: course.title,
    desc: course.tagline ?? course.overview,
    flag: critical
      ? { kind: 'critical', label: 'Exam-critical' }
      : { kind: 'tracked', label: 'Tracked' },
    level: String(course.level),
    credits: `${course.credits} credits`,
    questions: quiz ? String(quiz.bankSize) : undefined,
    timeLimit: quiz ? `${quiz.quiz.quizDurationMinutes} min` : '',
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
}

/** Cross the student account boundary before bookmark management renders. */
export default function BookmarksPage() {
  return <StudentAccessGate returnPath="/bookmarks"><Bookmarks /></StudentAccessGate>
}

function Bookmarks() {
  const catalog: BookmarkableCourse[] = courses.map((c) => ({
    id: c.id,
    code: c.code,
    slug: c.slug,
    contentKey: c.contentKey,
    cardProps: buildCardProps(c),
  }))
  return <BookmarksClient catalog={catalog} />
}
