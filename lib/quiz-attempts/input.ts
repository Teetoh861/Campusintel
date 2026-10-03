import 'server-only'
import { z } from 'zod'

const MAX_EXPECTED_REVISION = 2147483646
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const identity = {
  attemptId: uuid,
  courseContentKey: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}
const answer = z.object({
  questionId: uuid,
  ordinal: z.number().int().nonnegative().safe(),
  optionIndex: z.number().int().nonnegative().safe(),
}).strict()
const selectedQuestion = z.object({
  questionId: uuid,
  ordinal: z.number().int().nonnegative().safe(),
  publishedRevision: z.number().int().positive().safe(),
}).strict()
const revision = z.number().int().min(0).max(MAX_EXPECTED_REVISION)

// These are answer patches, not a replacement snapshot. Omitted/unanswered
// questions never create rows, and earlier accepted answers remain durable.
export const attemptWriteSchema = z.discriminatedUnion('operation', [
  z.object({ ...identity, operation: z.literal('start'), questions: selectedQuestion.array().min(1).max(100) }).strict(),
  z.object({ ...identity, operation: z.literal('record'), expectedRevision: revision,
    answers: answer.array().min(1) }).strict(),
  z.object({ ...identity, operation: z.literal('finish'), expectedRevision: revision,
    completion: z.enum(['submitted', 'timed_out']), answers: answer.array() }).strict(),
])

export type AttemptWriteInput = z.infer<typeof attemptWriteSchema>

export const attemptResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), attempt: z.object({
    id: uuid, revision: z.number().int().nonnegative(),
    status: z.enum(['in_progress', 'submitted', 'timed_out']),
    questionCount: z.number().int().positive(),
  }).strict() }).strict(),
  z.object({ status: z.enum(['signed-out', 'session-changed', 'invalid-request',
    'not-found', 'conflict', 'finalized', 'unavailable']) }).strict(),
])

export type AttemptWriteResult = z.infer<typeof attemptResultSchema>
