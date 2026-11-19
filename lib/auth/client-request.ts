'use client'

import { AUTH_MESSAGES } from './constants'

export const AUTH_BROWSER_TIMEOUT_MS = 20_000

/** Browser-only failures are distinct from the server's bounded diagnostics. */
export class AuthClientFailure extends Error {
  constructor(readonly kind: 'connection' | 'timeout' | 'invalid' | 'unsupported', readonly reference?: unknown) { super('Auth request unavailable') }
}

/** The deadline covers headers and JSON; aborting never means a mutation was rolled back. */
export async function fetchAuthReply(endpoint: string, init: RequestInit): Promise<{ response: Response; value: unknown }> {
  const controller = new AbortController()
  // Relay cancellation without requiring the newer AbortSignal.any browser API.
  const cancel = () => controller.abort()
  if (init.signal?.aborted) cancel()
  else init.signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  let reference: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new AuthClientFailure('timeout', reference)); controller.abort() }, AUTH_BROWSER_TIMEOUT_MS)
  })
  const read = async () => {
    let response: Response
    try {
      if (controller.signal.aborted) throw new AuthClientFailure('connection')
      response = await fetch(endpoint, { ...init, signal: controller.signal })
    } catch { throw new AuthClientFailure(timedOut ? 'timeout' : 'connection') }
    reference = response.headers?.get('X-CampusIntell-Auth-Reference')
    let value: unknown
    try { value = await response.json() }
    catch { throw new AuthClientFailure(timedOut ? 'timeout' : 'invalid', reference) }
    return { response, value }
  }
  try { return await Promise.race([read(), timeout]) }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel) }
}

/** An untrusted reply can supply only the server reference's exact, non-identifying syntax. */
export function authMessageReference(message: string, reference: unknown, unavailableResponse = false): string {
  const unavailable = message === AUTH_MESSAGES.unavailable || unavailableResponse &&
    (message === AUTH_MESSAGES.confirmationSignIn || message === AUTH_MESSAGES.recoveryRestart)
  return unavailable && typeof reference === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(reference)
    ? `${message} Reference: ${reference}` : message
}
