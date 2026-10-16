// lib/ai-practice/service.ts — Bounded generation of a personal, unverified practice set from extracted text.
import 'server-only'
import { AI_PRACTICE_LIMITS, AI_PRACTICE_PROMPT_VERSION, generationRequestSchema } from './contract'
import type { FailureReason, GenerationOutcome, UsageReport } from './contract'
import { estimateCostUsd } from './pricing'
import { buildGenerationPrompt } from './prompt'
import { ProviderError } from './provider'
import type { ProviderErrorCode, ProviderResponse, QuestionGenerationProvider } from './provider'
import { prepareSource } from './source'
import { modelOutputSchema, validateQuestions } from './validate'

export type GenerationDependencies = {
  provider: QuestionGenerationProvider | null
  /** Whole-call deadline, retries included. */
  timeoutMs: number
  now?: () => number
}

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
function minimumAccepted(requested: number): number {
  return Math.max(AI_PRACTICE_LIMITS.minQuestions, Math.ceil(requested / 2))
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
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

  const source = prepared.source
  const prompt = buildGenerationPrompt(request.course, source.passages, request.questionCount)
  const started = now()
  let response: ProviderResponse
  try {
    response = await provider.generate({ ...prompt, maxOutputTokens: AI_PRACTICE_LIMITS.maxOutputTokens,
      signal: AbortSignal.timeout(deps.timeoutMs) })
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('internal')
    return { status: 'failed', reason: PROVIDER_FAILURES[failure.code], usage: null, providerError: failure.code,
      providerDiagnostic: failure.diagnostic }
  }
  const usage: UsageReport = {
    provider: provider.id, model: response.model, ...response.usage,
    estimatedCostUsd: estimateCostUsd(response.model, response.usage), durationMs: Math.max(0, now() - started),
  }
  if (response.kind === 'refused') return { status: 'flagged-for-review', reason: 'provider-refusal', usage }
  if (response.kind === 'truncated') return { status: 'failed', reason: 'truncated-output', usage }

  const output = modelOutputSchema.safeParse(parseJson(response.text))
  if (!output.success) return { status: 'failed', reason: 'invalid-output', usage }
  const { assessment, questions } = output.data
  if (!assessment.appropriate) return { status: 'flagged-for-review', reason: 'inappropriate', usage }
  if (!assessment.relatedToCourse) return { status: 'flagged-for-review', reason: 'unrelated-to-course', usage }
  // Low confidence discards whatever was written: the PRD prefers an honest signal to thin questions.
  if (!assessment.sufficientMaterial || assessment.confidence === 'low') {
    return { status: 'insufficient-source', reason: 'low-confidence', usage }
  }
  const { accepted, rejected } = validateQuestions(questions, source, request.source.documentId,
    request.questionCount)
  if (accepted.length < minimumAccepted(request.questionCount)) {
    return { status: 'failed', reason: 'invalid-output', usage }
  }
  return { status: 'generated', usage, set: {
    formatVersion: 1,
    origin: 'ai-generated',
    visibility: 'personal',
    verification: 'unverified',
    course: request.course,
    source: { documentId: request.source.documentId, fileName: request.source.fileName,
      sha256: source.sha256, charCount: source.charCount, passageCount: source.passages.length },
    questions: accepted,
    generation: {
      provider: provider.id, model: response.model, promptVersion: AI_PRACTICE_PROMPT_VERSION,
      generatedAt: new Date(now()).toISOString(), confidence: assessment.confidence,
      requestedQuestionCount: request.questionCount, rejectedQuestionCount: rejected.length,
    },
  } }
}
