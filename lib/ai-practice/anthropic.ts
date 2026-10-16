// lib/ai-practice/anthropic.ts — Claude adapter over the Anthropic Messages API with structured output.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { EMPTY_PROVIDER_DIAGNOSTIC, ProviderError } from './provider'
import type { ProviderDiagnostic, ProviderErrorCode, ProviderRequest, ProviderResponse, QuestionGenerationProvider,
  TokenUsage } from './provider'

/** The subset of the SDK client this adapter uses; tests inject a fake with the same shape. */
export type AnthropicMessagesClient = {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal | null },
    ): PromiseLike<Anthropic.Message>
  }
}

export type AnthropicProviderOptions = {
  model: string
  /** Server-only key. Required unless a client is injected. */
  apiKey?: string
  /** Per-attempt transport timeout; the service's AbortSignal bounds the whole call including retries. */
  timeoutMs: number
  client?: AnthropicMessagesClient
}

// One retry absorbs a transient 429/5xx without letting a stuck call double the student's wait.
const SDK_MAX_RETRIES = 1

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
  }
}

// Documented Messages API error types (resources/shared ErrorType). Anything else is dropped, not echoed.
const KNOWN_ERROR_TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error',
  'not_found_error', 'rate_limit_error', 'timeout_error', 'overloaded_error', 'api_error', 'billing_error'])
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_TRANSPORT_CODE = /^[A-Z][A-Z0-9_]{1,47}$/
const MAX_CAUSE_DEPTH = 4
const HTTP_SERVER_ERROR = 500
const HTTP_OVERLOADED = 529

/** The first Node error code (ENOTFOUND, ECONNRESET, CERT_HAS_EXPIRED...) in the cause chain. */
function transportCodeOf(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && SAFE_TRANSPORT_CODE.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function diagnosticOf(error: unknown): ProviderDiagnostic {
  if (!(error instanceof Anthropic.APIError)) return { ...EMPTY_PROVIDER_DIAGNOSTIC, transportCode: transportCodeOf(error) }
  const type = typeof error.type === 'string' && KNOWN_ERROR_TYPES.has(error.type) ? error.type : null
  const requestId = typeof error.requestID === 'string' && SAFE_REQUEST_ID.test(error.requestID) ? error.requestID : null
  return { httpStatus: typeof error.status === 'number' ? error.status : null, errorType: type, requestId,
    transportCode: error instanceof Anthropic.APIConnectionError ? transportCodeOf(error.cause) : null }
}

/**
 * Map SDK errors to provider-neutral codes, most specific first, with a private diagnostic.
 * Vendor messages are discarded. The documented error type wins over the HTTP status where they differ.
 */
export function classifyAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  const diagnostic = diagnosticOf(error)
  const make = (code: ProviderErrorCode) => new ProviderError(code, diagnostic)
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) return make('timeout')
  if (error instanceof Anthropic.APIConnectionError) return make('transport')
  if (error instanceof Anthropic.APIError) {
    if (diagnostic.errorType === 'billing_error') return make('billing')
    if (diagnostic.errorType === 'overloaded_error' || error.status === HTTP_OVERLOADED) return make('overloaded')
    if (error instanceof Anthropic.AuthenticationError) return make('authentication')
    if (error instanceof Anthropic.PermissionDeniedError) return make('permission')
    if (error instanceof Anthropic.RateLimitError) return make('rate-limited')
    // The Messages endpoint itself always exists, so a 404 there means the model id is not served to this key.
    if (error instanceof Anthropic.NotFoundError) return make('unsupported-model')
    if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
      return make('invalid-request')
    }
    if (typeof error.status === 'number' && error.status >= HTTP_SERVER_ERROR) return make('server-error')
    return make('invalid-request')
  }
  if (error instanceof Error && error.name === 'AbortError') return make('timeout')
  // Not an SDK error at all: a local bug or unexpected runtime failure before any response.
  return make('internal')
}

/** Build the Claude adapter. The API key stays inside the SDK client and is never returned or logged. */
export function createAnthropicProvider(options: AnthropicProviderOptions): QuestionGenerationProvider {
  let client = options.client ?? null
  const messages = (): AnthropicMessagesClient => {
    if (client) return client
    if (!options.apiKey) throw new ProviderError('authentication')
    client = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: SDK_MAX_RETRIES })
    return client
  }
  return {
    id: 'anthropic',
    model: options.model,
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      let message: Anthropic.Message
      try {
        message = await messages().messages.create({
          model: options.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          // Thinking stays adaptive (the model default); effort is set explicitly because defaults vary by model.
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.outputSchema } },
        }, { signal: request.signal })
      } catch (error) {
        throw classifyAnthropicError(error)
      }
      const usage = usageOf(message)
      if (message.stop_reason === 'refusal') return { kind: 'refused', model: message.model, usage }
      if (message.stop_reason !== 'end_turn') return { kind: 'truncated', model: message.model, usage }
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      return { kind: 'completed', text, model: message.model, usage }
    },
  }
}
