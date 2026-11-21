// lib/ai-practice/stored-set.ts — Read-back validation and student view of stored personal sets.
// A stored set is re-validated on every read: the database proves ownership, not shape.
import { z } from 'zod'
import { AI_PRACTICE_LIMITS as LIMITS } from './contract'
import type { PersonalPracticeSet } from './contract'
import type { PersonalSetView } from './upload-contract'

const text = (max: number) => z.string().min(1).max(max)

const storedQuestion = z.object({
  id: z.string().regex(/^ai_[0-9a-f]{24}$/),
  prompt: text(LIMITS.maxPromptChars),
  options: z.array(text(LIMITS.maxOptionChars)).length(LIMITS.optionCount),
  correctOption: z.number().int().min(0).max(LIMITS.optionCount - 1),
  explanation: text(LIMITS.maxExplanationChars),
  section: text(LIMITS.maxSectionChars),
  grounding: z.object({
    documentId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    passageId: z.string().regex(/^[PN][1-9]\d*$/),
    passageStart: z.number().int().nonnegative(),
    passageEnd: z.number().int().nonnegative(),
    quote: text(LIMITS.maxQuoteChars),
  }).passthrough(),
}).passthrough()

// A set's source: the student's uploaded file, or one topic of CampusIntell's notes (lib/ai-practice/topic-set.ts).
const uploadSource = z.object({ fileName: text(255) }).passthrough()
const topicSource = z.object({ kind: z.literal('notes-topic'), itemId: z.string().uuid(), title: text(240),
  number: z.number().int().positive().nullable() }).passthrough()

export const storedSetSchema = z.object({
  formatVersion: z.literal(1),
  origin: z.literal('ai-generated'),
  visibility: z.literal('personal'),
  verification: z.literal('unverified'),
  source: z.union([topicSource, uploadSource]),
  questions: z.array(storedQuestion).min(1).max(LIMITS.maxQuestions),
}).passthrough()

/** Project a stored set into what the student sees; null when the stored shape is not trusted. */
export function toPersonalSetView(generationId: string, createdAt: string, stored: unknown): PersonalSetView | null {
  const parsed = storedSetSchema.safeParse(stored)
  if (!parsed.success) return null
  const fromTopic = topicSource.safeParse(parsed.data.source)
  const fromUpload = uploadSource.safeParse(parsed.data.source)
  const topic = fromTopic.success
    ? { itemId: fromTopic.data.itemId, title: fromTopic.data.title, number: fromTopic.data.number } : null
  return {
    generationId,
    createdAt,
    fileName: topic === null && fromUpload.success ? fromUpload.data.fileName : null,
    topic,
    questions: parsed.data.questions.map(question => ({
      id: question.id, prompt: question.prompt, options: [...question.options],
      correctOption: question.correctOption, explanation: question.explanation,
      section: question.section, sourceQuote: question.grounding.quote,
    })),
  }
}

/** The JSON stored for a freshly generated set; identical to the provider-neutral saved format. */
export function toStoredSet(set: PersonalPracticeSet): Record<string, unknown> {
  return JSON.parse(JSON.stringify(set)) as Record<string, unknown>
}
