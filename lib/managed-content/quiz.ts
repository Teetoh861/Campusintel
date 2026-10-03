// lib/managed-content/quiz.ts — Combine published CBT rows with repository quiz policy only.
import type { CourseQuiz } from '@/lib/data/quizzes'
import type { ManagedQuizQuestion } from './student-projection'

export type ManagedQuiz = {
  href: string
  bankSize: number
  attemptSize: number
  timerSeconds: number
  maxQuestions: number
  sections: string[]
  questions: ManagedQuizQuestion[]
}

/** A quiz is usable only when its published managed bank and historical policy are valid. */
export function getUsableManagedQuiz(
  slug: string,
  config: Omit<CourseQuiz, 'questions' | 'totalQuestions'> | undefined,
  questions: ReadonlyArray<ManagedQuizQuestion>,
): ManagedQuiz | null {
  if (!config || config.courseSlug !== slug || questions.length === 0 ||
      !Number.isSafeInteger(config.maxQuizQuestions) || config.maxQuizQuestions <= 0) return null
  const timerSeconds = config.quizDurationMinutes * 60
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) return null
  const sections = [...config.sections]
  for (const question of questions) {
    if (!sections.includes(question.section)) sections.push(question.section)
  }
  return {
    href: `/courses/${encodeURIComponent(slug)}/quiz`,
    bankSize: questions.length,
    attemptSize: Math.min(config.maxQuizQuestions, questions.length),
    timerSeconds,
    maxQuestions: config.maxQuizQuestions,
    sections,
    questions: [...questions],
  }
}
