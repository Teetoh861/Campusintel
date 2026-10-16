// lib/ai-practice/config.ts — Server-only AI practice configuration and provider selection.
// Only unprefixed variables are read; a NEXT_PUBLIC_ copy of a key is never consulted.
import 'server-only'
import { createAnthropicProvider } from './anthropic'
import { PRICED_ANTHROPIC_MODELS } from './pricing'
import type { QuestionGenerationProvider } from './provider'

// Sonnet 5.5 is the launch model; Opus 5.5 stays selectable through AI_PRACTICE_ANTHROPIC_MODEL for evaluation.
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
const DEFAULT_TIMEOUT_MS = 90_000
const MIN_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 120_000

export type AiPracticeConfig =
  | { status: 'enabled'; provider: 'anthropic'; model: string; timeoutMs: number; apiKey: string }
  | { status: 'disabled'; reason: 'feature-off' | 'missing-credential' | 'unsupported-provider' | 'unsupported-model' }

type Env = Readonly<Record<string, string | undefined>>

function timeoutFrom(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number(value)))
}

/**
 * Read configuration once per request. The feature stays off unless AI_PRACTICE_ENABLED is the
 * literal "true". An unimplemented provider disables the feature rather than falling back to another.
 */
export function readAiPracticeConfig(env: Env = process.env): AiPracticeConfig {
  if (env.AI_PRACTICE_ENABLED !== 'true') return { status: 'disabled', reason: 'feature-off' }
  const provider = env.AI_PRACTICE_PROVIDER ?? 'anthropic'
  // OpenAI is a reserved provider id with no adapter yet; selecting it must not reach any API.
  if (provider !== 'anthropic') return { status: 'disabled', reason: 'unsupported-provider' }
  const model = env.AI_PRACTICE_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL
  if (!PRICED_ANTHROPIC_MODELS.includes(model)) return { status: 'disabled', reason: 'unsupported-model' }
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.trim() === '') return { status: 'disabled', reason: 'missing-credential' }
  return { status: 'enabled', provider: 'anthropic', model, timeoutMs: timeoutFrom(env.AI_PRACTICE_TIMEOUT_MS), apiKey }
}

/** The configured adapter, or null when generation is disabled. */
export function createConfiguredProvider(config: AiPracticeConfig): QuestionGenerationProvider | null {
  if (config.status !== 'enabled') return null
  return createAnthropicProvider({ model: config.model, apiKey: config.apiKey, timeoutMs: config.timeoutMs })
}

/** Whether the student journey should be offered at all: enabled, supported and credentialed. */
export function isAiPracticeAvailable(env: Env = process.env): boolean {
  return readAiPracticeConfig(env).status === 'enabled'
}
