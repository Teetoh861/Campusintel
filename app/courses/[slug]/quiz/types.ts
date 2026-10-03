// Shared types for the quiz client + its screens. Kept separate so the
// presentational screens don't have to import QuizClient.
import type { ManagedQuizQuestion } from '@/lib/managed-content/student-projection'

export type Screen = 'intro' | 'active' | 'results'
export type ReviewFilter = 'missed' | 'all'

// qIndex (position in the attempt set) -> selected option index (0-based)
export type AnswersMap = Record<number, number>
export type MarkedMap = Record<number, boolean>

export type QuizCoreProps = {
  courseCode: string
  courseTitle: string
  courseSlug: string
  courseContentKey: string
  sections: ReadonlyArray<string>
  // Full bank; QuizClient samples and freezes an attempt before answer entry.
  questions: ReadonlyArray<ManagedQuizQuestion>
  timerSeconds: number
  maxQuestions: number
  totalInBank: number
}

export type SectionStat = {
  name: string
  letter: string
  total: number
  correct: number
  // Per-position result, in attempt order — drives the breakdown ticks.
  marks: ReadonlyArray<{ qIdx: number; ok: boolean }>
}
