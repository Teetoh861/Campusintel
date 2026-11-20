'use client'

export const AUTH_BROWSER_TIMEOUT_MS = 20_000

/** Browser-only failures are distinct from the server's bounded diagnostics. */
export class AuthClientFailure extends Error {
  constructor(readonly kind: 'connection' | 'timeout' | 'invalid' | 'unsupported') { super('Auth request unavailable') }
}

/** The deadline covers headers and JSON; aborting never means a mutation was rolled back. */
export async function fetchAuthReply(endpoint: string, init: RequestInit): Promise<{ response: Response; value: unknown }> {
  const controller = new AbortController()
  // Relay cancellation without requiring the newer AbortSignal.any browser API.
  const cancel = () => controller.abort()
  if (init.signal?.aborted) cancel()
  else init.signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new AuthClientFailure('timeout')); controller.abort() }, AUTH_BROWSER_TIMEOUT_MS)
  })
  const read = async () => {
    let response: Response
    try {
      if (controller.signal.aborted) throw new AuthClientFailure('connection')
      response = await fetch(endpoint, { ...init, signal: controller.signal })
    } catch { throw new AuthClientFailure(timedOut ? 'timeout' : 'connection') }
    let value: unknown
    try { value = await response.json() }
    catch { throw new AuthClientFailure(timedOut ? 'timeout' : 'invalid') }
    return { response, value }
  }
  try { return await Promise.race([read(), timeout]) }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel) }
}
