// Bookmarks (/bookmarks) — server-rendered shell. The actual saved set lives
// in localStorage, so the count + grid + empty state are owned by the client
// child. Precomputing CardProps for every course on the server keeps the
// client island free of data-shaping logic.
// directory.css owns .dir-count / .dir-title / .dir-lede / .dir-empty —
// pages.css references those classes without redefining them, so the
// bookmarks page needs both stylesheets just like the comp does.
import '../../styles/directory.css'
import '../../styles/pages.css'
import { courses } from '@/lib/data/courses'
import { quizzes } from '@/lib/data/quizzes'
import type { Course } from '@/lib/types'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import {
  BookmarksClient,
  type BookmarkableCourse,
} from './BookmarksClient'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

function buildCardProps(course: Course): CardProps {
  const quiz = quizzes[course.slug]
  const critical = course.examCritical === true
  return {
    code: course.code,
    title: course.title,
    flag: critical
      ? { kind: 'critical', label: 'Exam-critical' }
      : { kind: 'tracked', label: 'Tracked' },
    level: String(course.level),
    credits: `${course.credits} CR`,
    questions: quiz ? String(quiz.totalQuestions) : '—',
    timeLimit: quiz ? `${quiz.quizDurationMinutes} MIN` : '—',
    difficulty: toLevel(course.difficulty),
    cta: {
      label: 'View course',
      href: `/courses/${course.slug}`,
      variant: 'primary',
    },
    secondaryCta: critical
      ? {
          label: 'Start quiz',
          href: `/courses/${course.slug}/quiz`,
          variant: 'secondary',
          withArrow: true,
        }
      : undefined,
  }
}

export default function BookmarksPage() {
  const catalog: BookmarkableCourse[] = courses.map((c) => ({
    id: c.id,
    code: c.code,
    slug: c.slug,
    cardProps: buildCardProps(c),
  }))
  return <BookmarksClient catalog={catalog} />
}
