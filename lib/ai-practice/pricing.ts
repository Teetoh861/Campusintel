// lib/ai-practice/pricing.ts — Usage-to-cost reporting for development evaluation and quota design.
// Rates are USD per million tokens for the Anthropic first-party API, recorded 2026-10-16 from
// Anthropic's published model table. Confirm against the Console before using them for billing.
import { AI_PRACTICE_LIMITS } from './contract'
import type { TokenUsage } from './provider'

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }

const PER_MILLION: Record<string, Rates> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

/** Models the Anthropic adapter may be configured with; each has a known price. */
export const PRICED_ANTHROPIC_MODELS = Object.keys(PER_MILLION)

/** Haiku 5.5 doubles past 100K prompt tokens; the source cap keeps requests far below it. */
const TIERED_PROMPT_LIMIT = 100_000

/** Cost of one call, or null when the serving model is not in the table. Never estimated by analogy. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const rates = PER_MILLION[model]
  if (!rates) return null
  const prompt = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
  if (model === 'claude-haiku-5-5' && prompt > TIERED_PROMPT_LIMIT) return null
  const total = usage.inputTokens * rates.input + usage.outputTokens * rates.output +
    usage.cacheReadInputTokens * rates.cacheRead + usage.cacheCreationInputTokens * rates.cacheWrite
  return Number((total / 1_000_000).toFixed(6))
}

/** Upper bound for one request: a maximal source (about 4 chars per token) and every output token used. */
export function worstCaseCostUsd(model: string): number | null {
  const promptAllowanceTokens = 3_000
  return estimateCostUsd(model, {
    inputTokens: Math.ceil(AI_PRACTICE_LIMITS.maxSourceChars / 4) + promptAllowanceTokens,
    outputTokens: AI_PRACTICE_LIMITS.maxOutputTokens,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
  })
}
