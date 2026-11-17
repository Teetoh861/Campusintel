// lib/campus-bot/model-call.ts — The one provider request shape for Campus Bot replies (Explain, its check, Ask Campus
// Bot, and "Practise this topic"). A call names the model and the written-token cap the database admitted it at, how
// hard the model should work and its own deadline. Every outcome is a value: nothing here throws.
import 'server-only'
import { estimateCostUsd, PRICED_ANTHROPIC_MODELS } from '@/lib/ai-practice/pricing'
import { AiDeadlineError, withAiDeadline } from '@/lib/ai-practice/lifetime'
import { EMPTY_PROVIDER_DIAGNOSTIC, ProviderError } from '@/lib/ai-practice/provider'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderEffort, ProviderErrorCode, ProviderResponse, QuestionGenerationProvider }
  from '@/lib/ai-practice/provider'

/** The model and written-token cap the database reserved the request for (its `model` and `max_output_tokens`). */
export type CampusBotModelLimits = { model: string; maxOutputTokens: number }

export type CampusBotModelRequest = {
  system: string
  user: string
  /** JSON Schema of the reply: every Campus Bot reply is structured, so a page never depends on the model's wording. */
  outputSchema: Record<string, unknown>
  limits: CampusBotModelLimits
  effort: ProviderEffort
  /** Whole-call deadline, the adapter's one retry included. */
  timeoutMs: number
}

export type CampusBotModelResult =
  | { kind: 'completed'; json: unknown; usage: UsageReport }
  // The provider answered, but not with something usable: a refusal, a reply cut off at the cap, or not the JSON asked for.
  | { kind: 'refused' | 'truncated' | 'invalid'; usage: UsageReport }
  // No answer at all: a timeout, an outage, or a configuration problem. `diagnostic` is for the private log only.
  | { kind: 'failed'; code: ProviderErrorCode; diagnostic: ProviderDiagnostic }

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/** Call the provider once for one Campus Bot reply. A model this build cannot price is never called. */
export async function callCampusBotModel(provider: QuestionGenerationProvider, request: CampusBotModelRequest,
  now: () => number = Date.now): Promise<CampusBotModelResult> {
  if (!PRICED_ANTHROPIC_MODELS.includes(request.limits.model)) {
    return { kind: 'failed', code: 'unsupported-model', diagnostic: EMPTY_PROVIDER_DIAGNOSTIC }
  }
  const started = now()
  let response: ProviderResponse
  try {
    response = await withAiDeadline(signal => provider.generate({ system: request.system, user: request.user,
      outputSchema: request.outputSchema, maxOutputTokens: request.limits.maxOutputTokens, model: request.limits.model,
      effort: request.effort, signal }), request.timeoutMs)
  } catch (error) {
    const failure = error instanceof ProviderError ? error
      : new ProviderError(error instanceof AiDeadlineError ? 'timeout' : 'internal')
    return { kind: 'failed', code: failure.code, diagnostic: failure.diagnostic }
  }
  const usage: UsageReport = { provider: provider.id, model: response.model, ...response.usage,
    estimatedCostUsd: estimateCostUsd(response.model, response.usage), durationMs: Math.max(0, now() - started) }
  if (response.kind !== 'completed') return { kind: response.kind, usage }
  const json = parseJson(response.text)
  return json === undefined ? { kind: 'invalid', usage } : { kind: 'completed', json, usage }
}
