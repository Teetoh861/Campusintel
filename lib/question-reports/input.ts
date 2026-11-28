import 'server-only'
import { z } from 'zod'
import { REPORT_NOTE_MAX_CHARACTERS, noteWithinLimit } from './note-limit'

export { REPORT_NOTE_MAX_CHARACTERS } from './note-limit'
// Selector bounds the schema below enforces; the request budget is derived from these same numbers.
const UUID_LENGTH = 36
const REVISION_MAX = 2147483647
// The note limit counts code points, but the body travels as JSON text. JSON.stringify writes a control character
// (U+0000–U+001F) or a lone surrogate as a six-byte \uXXXX escape: wider than a quote or backslash (two bytes), any
// BMP character (at most three UTF-8 bytes) or an emoji (four), so six bounds every code point the schema permits.
const JSON_STRING_MAX_BYTES_PER_CODE_POINT = 6
/** The widest serialized form of a valid note: every one of its code points written as a \uXXXX escape. */
export const REPORT_NOTE_MAX_SERIALIZED_BYTES = REPORT_NOTE_MAX_CHARACTERS * JSON_STRING_MAX_BYTES_PER_CODE_POINT
/** The compact envelope around an empty note at the schema's own bounds: four canonical UUIDs, the ten-digit maximum
 * revision, six property names, the note's quotes, braces and commas. Computed, not estimated, so a schema change moves it. */
export const REPORT_ENVELOPE_BYTES = new TextEncoder().encode(JSON.stringify({
  courseId: 'f'.repeat(UUID_LENGTH), itemId: 'f'.repeat(UUID_LENGTH), revision: REVISION_MAX,
  questionId: 'f'.repeat(UUID_LENGTH), attemptId: 'f'.repeat(UUID_LENGTH), note: '',
})).length
// Fixed room for the envelope: more than its compact size so a pretty-printed body, or the first code point over
// the note limit (one more escape), still reaches the schema and fails as a note too long rather than as oversized.
export const REPORT_ENVELOPE_ALLOWANCE_BYTES = 512
/** The bounded HTTP body budget for one report: the widest valid note plus its envelope, never the Auth default. */
export const REPORT_REQUEST_MAX_BYTES = REPORT_NOTE_MAX_SERIALIZED_BYTES + REPORT_ENVELOPE_ALLOWANCE_BYTES
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const note = z.string().refine(noteWithinLimit)
  .refine(value => !value.includes('\u0000'))
  .transform(value => value.trim() || null).nullish().transform(value => value ?? null)

// These are selectors, never trusted relationships; SQL validates every association.
export const questionReportInput = z.object({
  courseId: uuid,
  itemId: uuid,
  revision: z.number().int().min(1).max(REVISION_MAX),
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
