// lib/ai-practice/provider.ts — The one seam between the practice service and any AI vendor.
// An adapter turns a provider-neutral prompt into raw reply text plus token usage. It never
// parses questions, decides outcomes or touches student data beyond the prompt it is given.

export type ProviderId = 'anthropic' | 'openai'

export type ProviderRequest = {
  system: string
  user: string
  outputSchema: Record<string, unknown>
  maxOutputTokens: number
  /** The service's overall deadline. Adapters must pass it to their transport. */
  signal: AbortSignal
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export type ProviderResponse =
  | { kind: 'completed'; text: string; model: string; usage: TokenUsage }
  | { kind: 'refused'; model: string; usage: TokenUsage }
  | { kind: 'truncated'; model: string; usage: TokenUsage }

/**
 * Provider failure classes. Operator-actionable: authentication, permission, billing, invalid-request,
 * unsupported-model, internal. Transient: timeout, rate-limited, overloaded, server-error, transport.
 */
export type ProviderErrorCode =
  | 'authentication' | 'permission' | 'billing' | 'invalid-request' | 'unsupported-model'
  | 'timeout' | 'rate-limited' | 'overloaded' | 'server-error' | 'transport' | 'internal'

/**
 * Private, operator-only detail for one failure. Holds no vendor message, credential, prompt or
 * student data: only the HTTP status, the documented error type, the request id for provider
 * support, and a transport error code such as ENOTFOUND.
 */
export type ProviderDiagnostic = {
  httpStatus: number | null
  errorType: string | null
  requestId: string | null
  transportCode: string | null
}

export const EMPTY_PROVIDER_DIAGNOSTIC: ProviderDiagnostic =
  Object.freeze({ httpStatus: null, errorType: null, requestId: null, transportCode: null })

/** Transport failures, classified once so the service never inspects vendor error types. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly diagnostic: ProviderDiagnostic
  constructor(code: ProviderErrorCode, diagnostic: ProviderDiagnostic = EMPTY_PROVIDER_DIAGNOSTIC) {
    // The message is a fixed code; vendor messages can echo request details and are dropped.
    super(`AI provider error: ${code}`)
    this.name = 'ProviderError'
    this.code = code
    this.diagnostic = diagnostic
  }
}

/** One log line for operators. Safe to write to server logs; never return it to a student. */
export function formatProviderDiagnostic(code: ProviderErrorCode, diagnostic: ProviderDiagnostic): string {
  const { httpStatus, errorType, requestId, transportCode } = diagnostic
  return [`code=${code}`, `status=${httpStatus ?? '-'}`, `type=${errorType ?? '-'}`,
    `request_id=${requestId ?? '-'}`, `transport=${transportCode ?? '-'}`].join(' ')
}

export interface QuestionGenerationProvider {
  readonly id: ProviderId
  readonly model: string
  generate(request: ProviderRequest): Promise<ProviderResponse>
}
