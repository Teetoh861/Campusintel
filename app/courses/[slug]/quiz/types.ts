// Shared types for the quiz client + its screens. Kept separate so the
// presentational screens don't have to import QuizClient.
import type { ManagedQuizQuestion } from '@/lib/managed-content/student-projection'

export type Screen = 'intro' | 'active' | 'results' | 'review'
export type ReviewFilter = 'all' | 'to-review' | 'correct'
export type ReviewStatus = 'correct' | 'incorrect' | 'unanswered'
// Derived from the recorder: saved only once the finished attempt row is confirmed.
export type SaveState = 'pending' | 'saved' | 'failed'

// qIndex (position in the attempt set) -> selected option index (0-based)
export type AnswersMap = Record<number, number>
export type MarkedMap = Record<number, boolean>

export type QuizCoreProps = {
  continuityToken: string
  courseCode: string
  courseTitle: string
  courseSlug: string
  // Central canonical course route; the client never reconstructs it.
  courseHref: string
  courseContentKey: string
  // Repository course UUID: the course selector the report backend validates.
  repositoryCourseId: string
  // Repository-only identity is presented honestly, never as an institutional owner.
  repositoryOnly: boolean
  sections: ReadonlyArray<string>
  // Full bank; QuizClient samples and freezes an attempt before answer entry.
  questions: ReadonlyArray<ManagedQuizQuestion>
  timerSeconds: number
  maxQuestions: number
  totalInBank: number
}

/** The exact item/revision a completed attempt can report, plus the attempt it ran in when that attempt was saved. */
export type ReportTarget = {
  courseId: string
  itemId: string
  revision: number
  questionId: string
  attemptId: string | null
}
