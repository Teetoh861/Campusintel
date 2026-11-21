// lib/courses/build-time-study.ts — What a shelf course publishes, fixed at build time from the committed content sources.
import 'server-only'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { STUDY_GUIDE_COURSES } from '@/lib/data/study-guide-courses'
import { getTheoryContentBySlug } from '@/lib/data/theory-questions'
import { getTopicNotesByCourseSlug } from '@/lib/data/topic-notes'
import type { StudyAvailability } from './read-model'

export type BuildTimeStudy = Pick<StudyAvailability, 'notes' | 'cbtPractice' | 'theory'>

/**
 * The study families the repository seed, the official bank migrations and the study-guide imports publish for a
 * course (the sources scripts/managed-content generates them from). Only for a course whose plan does not include it:
 * the database refuses every read of such a course, counts included, so this is the one honest source until a
 * count-only read exists.
 */
export function buildTimeStudy(slug: string): BuildTimeStudy {
  // A course's imported study guide: its topics are notes, and each carries a theory question.
  const guide = Object.hasOwn(STUDY_GUIDE_COURSES, slug) ? STUDY_GUIDE_COURSES[slug] : undefined
  return {
    notes: (getTopicNotesByCourseSlug(slug)?.topics?.length ?? 0) > 0 || (guide?.notes ?? 0) > 0,
    // A seed quiz or an official bank: the same configuration the read model uses for the course's practice.
    cbtPractice: getQuizConfigurationByCourseSlug(slug) !== undefined,
    theory: (getTheoryContentBySlug(slug)?.theoryQuestions?.length ?? 0) > 0 || (guide?.theory ?? 0) > 0,
  }
}
