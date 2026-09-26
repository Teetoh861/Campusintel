import type { Course, CourseQuiz } from '@/lib/types'

export type UsableCourseQuiz = {
  quiz: CourseQuiz
  href: string
  bankSize: number
  attemptSize: number
  timerSeconds: number
}

/** Resolve a quiz only when its course route can start a nonempty timed attempt. */
export function getUsableCourseQuiz(
  course: Pick<Course, 'slug'>,
  quiz: CourseQuiz | undefined,
): UsableCourseQuiz | null {
  if (!quiz || quiz.courseSlug !== course.slug || quiz.questions.length === 0 ||
      !Number.isSafeInteger(quiz.maxQuizQuestions) || quiz.maxQuizQuestions <= 0) {
    return null
  }
  const timerSeconds = quiz.quizDurationMinutes * 60
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) return null

  return {
    quiz,
    href: `/courses/${encodeURIComponent(course.slug)}/quiz`,
    bankSize: quiz.questions.length,
    attemptSize: Math.min(quiz.maxQuizQuestions, quiz.questions.length),
    timerSeconds,
  }
}
