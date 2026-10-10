import 'server-only'
import { z } from 'zod'

export const REPORT_NOTE_MAX_CHARACTERS = 1000
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const note = z.string().refine(value => Array.from(value).length <= REPORT_NOTE_MAX_CHARACTERS)
  .refine(value => !value.includes('\u0000'))
  .transform(value => value.trim() || null).nullish().transform(value => value ?? null)

// These are selectors, never trusted relationships; SQL validates every association.
export const questionReportInput = z.object({
  courseId: uuid,
  itemId: uuid,
  revision: z.number().int().min(1).max(2147483647),
  questionId: uuid.nullish().transform(value => value ?? null),
  attemptId: uuid.nullish().transform(value => value ?? null),
  note,
}).strict()

export const questionReportResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('reported'), reportId: uuid }).strict(),
  z.object({ status: z.literal('already-reported'), reportId: uuid }).strict(),
  z.object({ status: z.literal('limited') }).strict(),
])

export type QuestionReportInput = z.infer<typeof questionReportInput>
export type QuestionReportResult = z.infer<typeof questionReportResult>
  | { status: 'signed-out' | 'session-changed' | 'invalid-request' | 'unavailable' }
