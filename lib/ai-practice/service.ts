// lib/ai-practice/service.ts — Bounded generation of a personal, unverified practice set from extracted text.
import 'server-only'
import { AI_PRACTICE_LIMITS, AI_PRACTICE_PROMPT_VERSION, generationRequestSchema } from './contract'
import type { FailureReason, GenerationConfidence, GenerationOutcome, PersonalPracticeQuestion, UsageReport }
  from './contract'
import { estimateCostUsd, PRICED_ANTHROPIC_MODELS } from './pricing'
import { buildGenerationPrompt } from './prompt'
import { ProviderError } from './provider'
import { AiDeadlineError, withAiDeadline } from './lifetime'
import type { ProviderErrorCode, ProviderResponse, QuestionGenerationProvider } from './provider'
import { prepareSource } from './source'
import type { PreparedSource } from './source'
import { modelOutputSchema, validateQuestions } from './validate'

export type GenerationDependencies = {
  provider: QuestionGenerationProvider | null
  /** Whole-call deadline, retries included. */
  timeoutMs: number
  /** The model and written-token cap the database reserved this set for (token-funded sets). The set is charged by
   *  the provider's own usage report at the weights recorded with it, so the request must use exactly these. */
  limits?: GenerationLimits | null
  now?: () => number
}

export type GenerationLimits = { model: string; maxOutputTokens: number }

// Students see only these three plain reasons. Key, permission, billing, model and request problems are
// operator problems and read as an ordinary outage; the precise class goes to the private diagnostic.
const PROVIDER_FAILURES: Record<ProviderErrorCode, FailureReason> = {
  'timeout': 'timeout',
  'rate-limited': 'rate-limited',
  'overloaded': 'provider-unavailable',
  'server-error': 'provider-unavailable',
  'transport': 'provider-unavailable',
  'authentication': 'provider-unavailable',
  'permission': 'provider-unavailable',
  'billing': 'provider-unavailable',
  'invalid-request': 'provider-unavailable',
  'unsupported-model': 'provider-unavailable',
  'internal': 'provider-unavailable',
}

/** At least half of the requested questions must survive validation, or the set is not worth showing. */
export function minimumAccepted(requested: number): number {
  return Math.max(AI_PRACTICE_LIMITS.minQuestions, Math.ceil(requested / 2))
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/** What a model's reply to a set request is worth: the questions that survive, or why there is no set. */
export type AssessedQuestions =
  | { kind: 'accepted'; questions: PersonalPracticeQuestion[]; rejectedCount: number; confidence: GenerationConfidence }
  | { kind: 'insufficient-source'; reason: 'low-confidence' }
  | { kind: 'flagged-for-review'; reason: 'inappropriate' | 'unrelated-to-course' }
  | { kind: 'failed'; reason: 'invalid-output' }

/**
 * Judge a set reply, for uploads and notes topics alike: its own assessment first, then every question's grounding in
 * the cited passage (validate.ts). Fewer than half of the requested questions surviving is a failure, never a thin set.
 */
export function assessGeneratedQuestions(json: unknown, source: PreparedSource, documentId: string,
  questionCount: number, previousPrompts: ReadonlyArray<string> = []): AssessedQuestions {
  const output = modelOutputSchema.safeParse(json)
  if (!output.success) return { kind: 'failed', reason: 'invalid-output' }
  const { assessment, questions } = output.data
  if (!assessment.appropriate) return { kind: 'flagged-for-review', reason: 'inappropriate' }
  if (!assessment.relatedToCourse) return { kind: 'flagged-for-review', reason: 'unrelated-to-course' }
  // Low confidence discards whatever was written: the PRD prefers an honest signal to thin questions.
  if (!assessment.sufficientMaterial || assessment.confidence === 'low') {
    return { kind: 'insufficient-source', reason: 'low-confidence' }
  }
  const { accepted, rejected } = validateQuestions(questions, source, documentId, questionCount, previousPrompts)
  if (accepted.length < minimumAccepted(questionCount)) return { kind: 'failed', reason: 'invalid-output' }
  return { kind: 'accepted', questions: accepted, rejectedCount: rejected.length, confidence: assessment.confidence }
}

/**
 * Generate personal practice questions. Every outcome is a value: provider failures, unsafe or
 * thin material and unsupported replies all come back as typed results instead of exceptions.
 */
export async function generatePracticeSet(input: unknown, deps: GenerationDependencies): Promise<GenerationOutcome> {
  const now = deps.now ?? Date.now
  const parsed = generationRequestSchema.safeParse(input)
  if (!parsed.success) return { status: 'failed', reason: 'invalid-request', usage: null }
  const request = parsed.data
  const prepared = prepareSource(request.source.extractedText)
  if (prepared.status !== 'ok') return { status: 'insufficient-source', reason: prepared.status, usage: null }
  const provider = deps.provider
  if (!provider) return { status: 'failed', reason: 'not-configured', usage: null }

  const limits = deps.limits ?? null
  // A reserved model this build cannot price is never called: the reservation is released (failed costs nothing).
  if (limits !== null && !PRICED_ANTHROPIC_MODELS.includes(limits.model)) {
    return { status: 'failed', reason: 'not-configured', usage: null }
  }

  const source = prepared.source
  const prompt = buildGenerationPrompt(request.course, source.passages, request.questionCount)
  const started = now()
  let response: ProviderResponse
  try {
    response = await withAiDeadline(signal => provider.generate({ ...prompt,
      maxOutputTokens: limits?.maxOutputTokens ?? AI_PRACTICE_LIMITS.maxOutputTokens,
      ...(limits !== null ? { model: limits.model } : {}), signal }), deps.timeoutMs)
  } catch (error) {
    const failure = error instanceof ProviderError ? error
      : new ProviderError(error instanceof AiDeadlineError ? 'timeout' : 'internal')
    return { status: 'failed', reason: PROVIDER_FAILURES[failure.code], usage: null, providerError: failure.code,
      providerDiagnostic: failure.diagnostic }
  }
  const usage: UsageReport = {
    provider: provider.id, model: response.model, ...response.usage,
    estimatedCostUsd: estimateCostUsd(response.model, response.usage), durationMs: Math.max(0, now() - started),
  }
  if (response.kind === 'refused') return { status: 'flagged-for-review', reason: 'provider-refusal', usage }
  if (response.kind === 'truncated') return { status: 'failed', reason: 'truncated-output', usage }

  const assessed = assessGeneratedQuestions(parseJson(response.text), source, request.source.documentId,
    request.questionCount)
  if (assessed.kind === 'insufficient-source') return { status: 'insufficient-source', reason: assessed.reason, usage }
  if (assessed.kind === 'flagged-for-review') return { status: 'flagged-for-review', reason: assessed.reason, usage }
  if (assessed.kind === 'failed') return { status: 'failed', reason: assessed.reason, usage }
  return { status: 'generated', usage, set: {
    formatVersion: 1,
    origin: 'ai-generated',
    visibility: 'personal',
    verification: 'unverified',
    course: request.course,
    source: { documentId: request.source.documentId, fileName: request.source.fileName,
      sha256: source.sha256, charCount: source.charCount, passageCount: source.passages.length },
    questions: assessed.questions,
    generation: {
      provider: provider.id, model: response.model, promptVersion: AI_PRACTICE_PROMPT_VERSION,
      generatedAt: new Date(now()).toISOString(), confidence: assessed.confidence,
      requestedQuestionCount: request.questionCount, rejectedQuestionCount: assessed.rejectedCount,
    },
  } }
}
