// Shared types for the quiz client + its screens. Kept separate so the
// presentational screens don't have to import QuizClient.
import type { GradedQuestion, PracticeQuestion } from '@/lib/practice/contract'

export type { GradedQuestion, PracticeQuestion }
export type Screen = 'intro' | 'resume' | 'active' | 'results' | 'review'
export type ReviewFilter = 'all' | 'to-review' | 'correct'
export type ReviewStatus = 'correct' | 'incorrect' | 'unanswered'

// qIndex (position in the attempt) -> selected option index (0-based)
export type AnswersMap = Record<number, number>
export type MarkedMap = Record<number, boolean>

/** The brief a fresh start runs under: the server's question count and time, never worked out in the browser. */
export type PracticeBrief = { questionCount: number; durationSeconds: number }

/** The exact item/revision a graded attempt can report, and the attempt it ran in. */
export type ReportTarget = {
  courseId: string
  itemId: string
  revision: number
  questionId: string
  attemptId: string | null
}

/** One line under the question about this tab's answers; never "saved" before the server confirmed it. */
export type SaveLine = { text: string; retry: boolean } | null
