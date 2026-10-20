// Shared theory submission bounds and the published feedback that may cross the client boundary.
import { z } from 'zod'

// Client-side draft bounds. Drafts and reflections stay in page state and are never sent.
export const THEORY_ANSWER_MAX_LENGTH = 20000
export const THEORY_REFLECTION_MAX_LENGTH = 4000
// The disclosure request carries only slug, item UUID and revision.
export const THEORY_BODY_MAX_BYTES = 1024

/** Identify the published question to disclose. Strict: an `answer` or any other extra field is refused. */
export const theorySubmission = z.object({
  courseSlug: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  itemId: z.string().uuid(),
  publishedRevision: z.number().int().positive(),
}).strict()

export const theoryQuestion = z.object({
  itemId: z.string().uuid(), publishedRevision: z.number().int().positive(),
  prompt: z.string().min(1).max(20000), examTip: z.string().max(10000).optional(),
  displayNumber: z.number().int().positive().optional(),
}).strict()

const publishedText = z.object({
  itemId: z.string().uuid(), publishedRevision: z.number().int().positive(),
  body: z.string().min(1).max(200000),
}).strict()

export const theoryFeedback = z.object({
  question: theoryQuestion,
  modelAnswer: publishedText,
  rubric: publishedText.extend({ points: z.array(z.string().min(1).max(200000)).min(1) }).strict().nullable(),
}).strict()

export type TheorySubmission = z.infer<typeof theorySubmission>
export type TheoryQuestion = z.infer<typeof theoryQuestion>
export type TheoryFeedback = z.infer<typeof theoryFeedback>
export type SelfRating = 'covered' | 'partly' | 'not-yet'
export type TheorySubmitResult =
  | { status: 'ready'; feedback: TheoryFeedback }
  | { status: 'signed-out' | 'session-changed' | 'incomplete' | 'invalid-request' | 'not-found' |
      'content-changed' | 'locked' | 'unavailable' }

/** Count only the student's selections; these are coverage counts, never official marks. */
export function countSelfRatings(points: ReadonlyArray<string>, ratings: Readonly<Record<number, SelfRating>>) {
  const counts = { covered: 0, partly: 0, 'not-yet': 0, reviewed: 0, total: points.length }
  points.forEach((_, index) => {
    const rating = ratings[index]
    if (rating !== undefined) { counts[rating] += 1; counts.reviewed += 1 }
  })
  return counts
}
