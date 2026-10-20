// lib/entitlements/termii.ts — Termii SMS adapter for trial activation codes (approved provider).
// POST {account base URL}/api/sms/send, https://developers.termii.com/messaging-api. Server-only: the API key, the
// recipient and the code never leave this module except in the one HTTPS request, and nothing here logs.
import 'server-only'
import type { SmsDelivery, SmsProvider } from './sms'

type Env = Readonly<Record<string, string | undefined>>

// Termii keys and sender IDs as issued; anything else is a configuration mistake, not something to send with.
const API_KEY = /^[A-Za-z0-9_.-]{16,256}$/
const SENDER_ID = /^[A-Za-z0-9]{3,11}$/
const NIGERIAN_E164 = /^\+234[789]\d{9}$/
// The provider gets its own deadline inside the caller's, so a slow gateway can never hold the request open.
export const TERMII_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 8 * 1024

export type TermiiConfig = { origin: string; apiKey: string; senderId: string }

export type TermiiConfigResult =
  | { status: 'ok'; config: TermiiConfig }
  | { status: 'missing-setting' | 'invalid-setting' }

/** The account base URL must be an HTTPS Termii origin, so a mistyped or hostile value cannot receive the key. */
function termiiOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
        !['', '/'].includes(url.pathname) || !(host === 'termii.com' || host.endsWith('.termii.com'))) return null
    return url.origin
  } catch { return null }
}

/** Every setting is required; none has a default. */
export function readTermiiConfig(env: Env): TermiiConfigResult {
  const apiKey = env.TERMII_API_KEY
  const baseUrl = env.TERMII_BASE_URL
  const senderId = env.TERMII_SENDER_ID
  if (!apiKey || !baseUrl || !senderId) return { status: 'missing-setting' }
  const origin = termiiOrigin(baseUrl)
  if (!API_KEY.test(apiKey) || !SENDER_ID.test(senderId) || origin === null) return { status: 'invalid-setting' }
  return { status: 'ok', config: { origin, apiKey, senderId } }
}

/**
 * Start releasing a stream without ever waiting for it. cancel() may resolve, reject, throw synchronously or never
 * settle; none of those can delay the caller, and a rejection is always handled.
 */
function release(cancel: () => Promise<void> | undefined): void {
  try { cancel()?.catch(() => undefined) } catch { /* already closed, errored or locked: nothing left to release */ }
}

/**
 * Read at most MAX_RESPONSE_BYTES of a JSON body, counting real bytes as they arrive. A declared length over the limit
 * is refused before any byte is read; an undeclared (chunked) body is cancelled the moment it passes the limit. Every
 * read races the request deadline, so neither a stalled stream nor a cancellation that never settles can hold the
 * caller past it. Anything unreadable is `undefined`, never a partial parse.
 */
async function boundedJson(response: Response, deadline: AbortSignal): Promise<unknown> {
  const body = response.body
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d{1,15}$/.test(declared.trim()) || Number(declared) > MAX_RESPONSE_BYTES)) {
    if (body) release(() => body.cancel())
    return undefined
  }
  if (body === null) return undefined
  if (deadline.aborted) { release(() => body.cancel()); return undefined }
  const reader = body.getReader()
  let onAbort: () => void = () => {}
  const aborted = new Promise<'aborted'>(resolve => {
    onAbort = () => resolve('aborted')
    deadline.addEventListener('abort', onAbort, { once: true })
  })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), aborted])
      if (next === 'aborted') { release(() => reader.cancel()); return undefined }
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) { release(() => reader.cancel()); return undefined }
      chunks.push(next.value)
    }
  } catch {
    release(() => reader.cancel())
    return undefined
  } finally {
    deadline.removeEventListener('abort', onAbort)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return undefined }
}

/** Accepted only with a message id and no contrary code; anything else 2xx is ambiguous. */
function acceptedBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const id = 'message_id' in body ? body.message_id : 'message_id_str' in body ? body.message_id_str : undefined
  const code = 'code' in body ? body.code : undefined
  const idPresent = (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id))
  return idPresent && (code === undefined || code === 'ok')
}

/**
 * Classify one HTTP outcome. `failed` only for a definite refusal (4xx other than a timeout), so the student may
 * retry at once; a 5xx, timeout, network error or unreadable success is `unknown`, which still counts against every
 * send limit because the message may have gone out.
 */
export function classifyTermiiResponse(status: number, body: unknown): SmsDelivery {
  if (status >= 200 && status < 300) return acceptedBody(body) ? 'sent' : 'unknown'
  if (status >= 400 && status < 500 && status !== 408) return 'failed'
  return 'unknown'
}

export function createTermiiProvider(config: TermiiConfig, transport: typeof fetch = fetch): SmsProvider {
  return {
    id: 'termii',
    async send(to, body, signal): Promise<SmsDelivery> {
      // Never sent: only normalized Nigerian numbers reach here, in Termii's international form without '+'.
      if (!NIGERIAN_E164.test(to)) return 'failed'
      // One deadline covers the request and the body: a slow trickle cannot outlive it.
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(TERMII_TIMEOUT_MS)])
      let response: Response
      try {
        response = await transport(`${config.origin}/api/sms/send`, {
          method: 'POST', cache: 'no-store', redirect: 'error', signal: deadline,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ api_key: config.apiKey, to: to.slice(1), from: config.senderId, sms: body,
            type: 'plain', channel: 'dnd' }),
        })
      } catch {
        // A timeout or dropped connection may follow acceptance: the send stays counted.
        return 'unknown'
      }
      if (response.status >= 200 && response.status < 300) {
        return classifyTermiiResponse(response.status, await boundedJson(response, deadline))
      }
      // Refusals and errors are classified by status alone; their bodies are never read or waited for.
      const refused = response.body
      if (refused) release(() => refused.cancel())
      return classifyTermiiResponse(response.status, undefined)
    },
  }
}
