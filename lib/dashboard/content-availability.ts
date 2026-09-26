import 'server-only'
import { getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getUsableCourseQuiz } from '@/lib/data/quiz-availability'
import { getTheoryContentBySlug } from '@/lib/data/theory-questions'
import { getTopicNotesByCourseSlug } from '@/lib/data/topic-notes'
import type { Course } from '@/lib/types'

export type ContentAvailability = {
  notes: { hasData: boolean; href: null }
  cbt: { hasData: boolean; href: string | null }
  theory: { hasData: boolean; href: string | null }
}

/** Derive coverage and currently usable actions from repository content only. */
export function getContentAvailability(course: Course): ContentAvailability {
  const slug = course.slug
  const courseHref = `/courses/${encodeURIComponent(slug)}`
  const notes = getTopicNotesByCourseSlug(slug)
  const quiz = getQuizByCourseSlug(slug)
  const theory = getTheoryContentBySlug(slug)
  const hasQuiz = (quiz?.questions.length ?? 0) > 0
  const hasTheory = (theory?.theoryQuestions.length ?? 0) > 0
  const courseRouteOpensContent = getCourseBySlug(slug)?.contentKey === course.contentKey
  const usableQuiz = getUsableCourseQuiz(course, quiz)

  return {
    // Topic notes have no student-facing route yet. Resource request cards do
    // not establish whether study content is available.
    notes: { hasData: (notes?.topics.length ?? 0) > 0, href: null },
    cbt: { hasData: hasQuiz, href: courseRouteOpensContent ? usableQuiz?.href ?? null : null },
    theory: { hasData: hasTheory, href: courseRouteOpensContent && hasTheory ? courseHref : null },
  }
}
