// lib/managed-content/quiz.ts — Combine the published practice bank size with repository quiz policy only.
import type { CourseQuiz } from '@/lib/data/quizzes'

/** What a course offers for practice. The bank itself never leaves the database (published_cbt_summary). */
export type ManagedQuiz = {
  href: string
  bankSize: number
  attemptSize: number
  timerSeconds: number
  maxQuestions: number
  sections: string[]
}

/** A quiz is usable only when its published bank has valid questions and its historical policy is valid. */
export function getUsableManagedQuiz(
  slug: string,
  config: Omit<CourseQuiz, 'questions' | 'totalQuestions'> | undefined,
  bankSize: number,
): ManagedQuiz | null {
  if (!config || config.courseSlug !== slug || !Number.isSafeInteger(bankSize) || bankSize <= 0 ||
      !Number.isSafeInteger(config.maxQuizQuestions) || config.maxQuizQuestions <= 0) return null
  const timerSeconds = config.quizDurationMinutes * 60
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) return null
  return {
    href: `/courses/${encodeURIComponent(slug)}/quiz`,
    bankSize,
    attemptSize: Math.min(config.maxQuizQuestions, bankSize),
    timerSeconds,
    maxQuestions: config.maxQuizQuestions,
    sections: [...config.sections],
  }
}
