// lib/ai-practice/upload-contract.ts — Client-safe contract for the student upload-to-practice journey.
// The browser and the route share these limits and shapes; the server re-checks every one of them.
import { z } from 'zod'

/** Matches the Storage bucket's file_size_limit (supabase/migrations/20261016140000_ai_practice_uploads.sql). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export const ACCEPTED_UPLOAD_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
} as const
export type UploadMediaType = keyof typeof ACCEPTED_UPLOAD_TYPES

/** File-picker accept attribute: extensions and media types together, because browsers disagree on both. */
export const UPLOAD_ACCEPT_ATTRIBUTE = [...Object.values(ACCEPTED_UPLOAD_TYPES), ...Object.keys(ACCEPTED_UPLOAD_TYPES)].join(',')

/** The media type an uploaded file name implies, or null. Extensions decide; browser MIME guesses do not. */
export function mediaTypeForFileName(fileName: string): UploadMediaType | null {
  const extension = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0]
  const match = Object.entries(ACCEPTED_UPLOAD_TYPES).find(([, ext]) => ext === extension)
  return match ? match[0] as UploadMediaType : null
}

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const mediaType = z.enum(Object.keys(ACCEPTED_UPLOAD_TYPES) as [UploadMediaType, ...UploadMediaType[]])

// File names are display-only; control characters and path separators are refused outright.
const fileName = z.string().min(1).max(255).refine(value => value.trim().length > 0 && !/[\u0000-\u001F\u007F/\\]/.test(value))

export const aiPracticeCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('reserve-upload'), courseId: uuid, fileName, mediaType,
    byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES) }).strict(),
  z.object({ operation: z.literal('process-upload'), documentId: uuid }).strict(),
  z.object({ operation: z.literal('generate'), documentId: uuid, requestId: uuid }).strict(),
])
export type AiPracticeCommand = z.infer<typeof aiPracticeCommandSchema>

/** Why an uploaded file was refused. Matches the database's rejection_reason values. */
export type UploadRejection =
  | 'missing-upload' | 'too-large' | 'unsupported-type' | 'corrupt' | 'encrypted' | 'empty' | 'too-short' | 'too-much-text'

/** Where an AI grant came from. Only trusted server code issues grants; AI use never creates one. */
export type AiGrantSource = 'trial' | 'early_access' | 'test'

/** The student's AI grant. 'not-entitled' means no grant this deployment accepts exists yet. */
export type AllowanceSummary = {
  state: 'not-entitled' | 'active' | 'expired'
  source: AiGrantSource | null
  /** Null for an uncapped grant (Early Access): no per-student total, while the global and daily guards still apply. */
  total: number | null
  used: number
  endsAt: string | null
}

/** Student-safe question shape: personal and unverified, with the quote that grounds the answer. */
export type PersonalQuestionView = {
  id: string
  prompt: string
  options: string[]
  correctOption: number
  explanation: string
  section: string
  sourceQuote: string
}

export type PersonalSetView = {
  generationId: string
  createdAt: string
  fileName: string | null
  questions: PersonalQuestionView[]
}

/** Every result the route can return. None carries source text, prompts, keys or provider detail. */
export type AiPracticeResult =
  | { status: 'upload-reserved'; documentId: string; uploadUrl: string }
  | { status: 'upload-ready'; documentId: string }
  | { status: 'upload-rejected'; reason: UploadRejection }
  | { status: 'generated'; set: PersonalSetView; allowance: AllowanceSummary | null }
  | { status: 'insufficient-source' | 'flagged-for-review' | 'generation-failed'; allowance: AllowanceSummary | null }
  | { status: 'allowance-exhausted' | 'allowance-expired'; allowance: AllowanceSummary | null }
  | { status: 'not-entitled' }
  | { status: 'busy' | 'capacity' | 'upload-limit' | 'not-eligible' | 'disabled' | 'not-found' | 'signed-out'
      | 'session-changed' | 'invalid-request' | 'unavailable' }

export const UPLOAD_REJECTION_MESSAGES: Record<UploadRejection, string> = {
  'missing-upload': 'The file did not finish uploading. Choose it again.',
  'too-large': 'This file is larger than 5 MB. Upload a smaller file or split your notes.',
  'unsupported-type': 'Upload a PDF, Word (.docx) or plain text (.txt) file. Older .doc files are not supported.',
  'corrupt': 'We could not read this file. It may be damaged, or a scanned image without selectable text.',
  'encrypted': 'This file is password-protected. Remove the password and upload it again.',
  'empty': 'We could not find any text in this file. Upload a file with selectable text; scanned images are not supported.',
  'too-short': 'There is not enough text here to write fair questions. Upload fuller notes (at least about 150 words).',
  'too-much-text': 'This file has more text than we can use at once. Upload one topic or chapter at a time.',
}
