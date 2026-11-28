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

/** The model and token caps the database reserved the request for (its `model`, `max_input_tokens` and
 *  `max_output_tokens`). The reservation covers exactly these, so a call never exceeds either. */
export type CampusBotModelLimits = { model: string; maxInputTokens: number; maxOutputTokens: number }

/** Room for what the API adds around the prompt (roles, the structured-output instructions). */
const PROMPT_OVERHEAD_TOKENS = 400

/** An upper estimate of the input tokens a prompt can cost: the system and user text and the reply's schema at two
 *  characters a token (Claude's tokens average well over three characters of this text), plus the API's own
 *  overhead. The database also never charges more than it reserved; this keeps a call inside its cap in the first
 *  place. */
export function promptTokenBound(prompt: { system: string; user: string; outputSchema: Record<string, unknown> }): number {
  const chars = prompt.system.length + prompt.user.length + JSON.stringify(prompt.outputSchema).length
  return Math.ceil(chars / 2) + PROMPT_OVERHEAD_TOKENS
}

/** The prompt built from as much of the notes as fits the input cap: passages are left off from the end (the least
 *  relevant search result, or a topic's last lessons and recap) until it fits. Null when even one passage does not. */
export function fitNotesPrompt<N extends { passages: ReadonlyArray<unknown> }, P extends CampusBotPromptShape>(
  notes: N, build: (notes: N) => P, limits: CampusBotModelLimits): { notes: N; prompt: P } | null {
  for (let count = notes.passages.length; count >= 1; count -= 1) {
    const fitted = { ...notes, passages: notes.passages.slice(0, count) } as N
    const prompt = build(fitted)
    if (promptFits(prompt, limits)) return { notes: fitted, prompt }
  }
  return null
}

/** Keep the whole topic before chat history. Only notes that exceed the cap with no history may lose passages. */
export function fitChatPrompt<N extends { passages: ReadonlyArray<unknown> }, T, P extends CampusBotPromptShape>(
  notes: N, turns: ReadonlyArray<T>, build: (notes: N, turns: ReadonlyArray<T>) => P, limits: CampusBotModelLimits,
): { notes: N; turns: ReadonlyArray<T>; prompt: P } | null {
  for (let dropped = 0; dropped <= turns.length; dropped += 1) {
    const recent = turns.slice(dropped)
    const prompt = build(notes, recent)
    if (promptFits(prompt, limits)) return { notes, turns: recent, prompt }
  }
  const fitted = fitNotesPrompt(notes, remaining => build(remaining, []), limits)
  return fitted === null ? null : { ...fitted, turns: [] }
}

type CampusBotPromptShape = { system: string; user: string; outputSchema: Record<string, unknown> }

/** Whether a prompt fits the input cap it was admitted with. */
export function promptFits(prompt: { system: string; user: string; outputSchema: Record<string, unknown> },
  limits: CampusBotModelLimits): boolean {
  return promptTokenBound(prompt) <= limits.maxInputTokens
}

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
  // A prompt that could cost more input than was reserved is never sent.
  if (!promptFits(request, request.limits)) {
    return { kind: 'failed', code: 'invalid-request', diagnostic: EMPTY_PROVIDER_DIAGNOSTIC }
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
