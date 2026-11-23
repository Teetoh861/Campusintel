// lib/courses/build-time-study.ts — What a shelf course publishes, fixed at build time from the generated published state.
import 'server-only'
import { PUBLISHED_STUDY } from '@/lib/data/published-study'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import type { StudyAvailability } from './read-model'

export type BuildTimeStudy = Pick<StudyAvailability, 'notes' | 'cbtPractice' | 'theory'>

/**
 * The study families a course publishes after every migration (lib/data/published-study.ts, which
 * scripts/managed-content/generate.cjs writes from the same sources as the migrations). Only for a course whose plan
 * does not include it: the database refuses every read of such a course, counts included, so this is the one honest
 * source until a count-only read exists.
 */
export function buildTimeStudy(slug: string): BuildTimeStudy {
  const published = Object.hasOwn(PUBLISHED_STUDY, slug) ? PUBLISHED_STUDY[slug] : undefined
  return {
    notes: (published?.notes ?? 0) > 0,
    // Practice also needs the course's quiz configuration, as the read model does.
    cbtPractice: (published?.cbt ?? 0) > 0 && getQuizConfigurationByCourseSlug(slug) !== undefined,
    theory: (published?.theory ?? 0) > 0,
  }
}
