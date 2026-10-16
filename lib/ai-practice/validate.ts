// lib/ai-practice/validate.ts — Strict validation of model output and verbatim source grounding.
// The provider's schema enforcement is a convenience; this module is the gate that decides what is kept.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AI_PRACTICE_LIMITS as LIMITS } from './contract'
import type { PersonalPracticeQuestion } from './contract'
import type { PreparedSource } from './source'

const text = (max: number) => z.string().max(max).refine(value => value.trim().length > 0)

// Lengths are generous at this layer so one bad question cannot void the set; per-question rules follow.
const rawQuestion = z.object({
  prompt: z.string().max(LIMITS.maxPromptChars * 4),
  options: z.array(z.string().max(LIMITS.maxOptionChars * 4)).max(LIMITS.optionCount * 2),
  correctOptionIndex: z.number(),
  explanation: z.string().max(LIMITS.maxExplanationChars * 4),
  section: z.string().max(LIMITS.maxSectionChars * 4),
  sourcePassageId: z.string().max(16),
  sourceQuote: z.string().max(LIMITS.maxQuoteChars * 4),
}).strict()

export const modelOutputSchema = z.object({
  assessment: z.object({
    sufficientMaterial: z.boolean(),
    relatedToCourse: z.boolean(),
    appropriate: z.boolean(),
    confidence: z.enum(['low', 'medium', 'high']),
    assessmentNote: z.string().max(2_000),
  }).strict(),
  questions: z.array(rawQuestion).max(LIMITS.maxQuestions * 2),
}).strict()
export type ModelOutput = z.infer<typeof modelOutputSchema>
type RawQuestion = z.infer<typeof rawQuestion>

const acceptedQuestion = z.object({
  prompt: text(LIMITS.maxPromptChars),
  options: z.array(text(LIMITS.maxOptionChars)).length(LIMITS.optionCount),
  correctOptionIndex: z.number().int().min(0).max(LIMITS.optionCount - 1),
  explanation: text(LIMITS.maxExplanationChars),
  section: text(LIMITS.maxSectionChars),
  sourcePassageId: z.string().regex(/^P[1-9]\d*$/),
  sourceQuote: z.string().min(LIMITS.minQuoteChars).max(LIMITS.maxQuoteChars),
})

export type RejectionReason =
  | 'shape' | 'unknown-passage' | 'ungrounded-quote' | 'duplicate-options' | 'duplicate-question' | 'catch-all-option'
  | 'answer-unsupported' | 'distractor-in-quote'

/**
 * Comparison form only: case, whitespace, quote marks, dashes and bracket widths are
 * not evidence of fabrication, so they must not decide whether a quote is grounded.
 */
export function canonicalForComparison(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

const CATCH_ALL = /^(all|none|both|neither) of the (above|options)$/
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'was', 'were', 'with', 'that', 'this', 'from', 'into',
  'its', 'their', 'they', 'them', 'than', 'then', 'which', 'what', 'when', 'who', 'not', 'but', 'all', 'any',
  'can', 'has', 'have', 'had', 'does', 'did', 'only', 'also', 'more', 'most', 'such', 'other', 'each', 'one'])

/** Distinct meaningful words: the evidence an option has to share with the notes. */
function contentWords(value: string): string[] {
  return [...new Set(canonicalForComparison(value).match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !STOP_WORDS.has(word))
}

/**
 * Two cheap sense checks on the key. The correct option must share meaningful words with its cited
 * passage (a wholly unrelated key is a fabrication), and no wrong option may be stated verbatim in the
 * supporting quote (that makes it arguably correct too). Neither proves the question is good.
 */
function answerRejection(question: z.infer<typeof acceptedQuestion>, passageText: string): RejectionReason | null {
  const passage = new Set(contentWords(passageText))
  const keyWords = contentWords(question.options[question.correctOptionIndex]!)
  if (keyWords.length > 0 && !keyWords.some(word => passage.has(word))) return 'answer-unsupported'
  const quote = canonicalForComparison(question.sourceQuote)
  const distractorStated = question.options.some((option, index) => index !== question.correctOptionIndex &&
    // Single terms are often named in the quote only to be contrasted ("value, not cost"); phrases are not.
    contentWords(option).length >= 2 && quote.includes(canonicalForComparison(option)))
  return distractorStated ? 'distractor-in-quote' : null
}

function rejectionFor(question: z.infer<typeof acceptedQuestion>, source: PreparedSource,
  seenPrompts: Set<string>): RejectionReason | null {
  const passage = source.passages.find(entry => entry.id === question.sourcePassageId)
  if (!passage) return 'unknown-passage'
  const quote = canonicalForComparison(question.sourceQuote)
  if (quote.length < LIMITS.minQuoteChars || !canonicalForComparison(passage.text).includes(quote)) {
    return 'ungrounded-quote'
  }
  const options = question.options.map(canonicalForComparison)
  if (new Set(options).size !== options.length) return 'duplicate-options'
  if (options.some(option => CATCH_ALL.test(option.replace(/[.!]$/, '')))) return 'catch-all-option'
  if (seenPrompts.has(canonicalForComparison(question.prompt))) return 'duplicate-question'
  return answerRejection(question, passage.text)
}

function questionId(sourceSha256: string, question: z.infer<typeof acceptedQuestion>): string {
  const digest = createHash('sha256')
    .update(`${sourceSha256}\n${question.sourcePassageId}\n${canonicalForComparison(question.prompt)}`, 'utf8')
    .digest('hex')
  return `ai_${digest.slice(0, 24)}`
}

/** Keep only well-formed, distinct questions whose quote appears verbatim in the cited passage. */
export function validateQuestions(
  raw: ReadonlyArray<RawQuestion>, source: PreparedSource, documentId: string, limit: number,
): { accepted: PersonalPracticeQuestion[]; rejected: { index: number; reason: RejectionReason }[] } {
  const accepted: PersonalPracticeQuestion[] = []
  const rejected: { index: number; reason: RejectionReason }[] = []
  const seenPrompts = new Set<string>()
  raw.forEach((candidate, index) => {
    if (accepted.length >= limit) return
    const parsed = acceptedQuestion.safeParse(candidate)
    if (!parsed.success) { rejected.push({ index, reason: 'shape' }); return }
    const reason = rejectionFor(parsed.data, source, seenPrompts)
    if (reason !== null) { rejected.push({ index, reason }); return }
    const question = parsed.data
    seenPrompts.add(canonicalForComparison(question.prompt))
    const passage = source.passages.find(entry => entry.id === question.sourcePassageId)!
    accepted.push({
      id: questionId(source.sha256, question),
      prompt: question.prompt.trim(),
      options: question.options.map(option => option.trim()),
      correctOption: question.correctOptionIndex,
      explanation: question.explanation.trim(),
      section: question.section.trim(),
      grounding: {
        documentId, sourceSha256: source.sha256, passageId: passage.id,
        passageStart: passage.start, passageEnd: passage.end, quote: question.sourceQuote.trim(),
      },
    })
  })
  return { accepted, rejected }
}
