// The reservation outlasts admission, two maximum provider calls, and settlement. Keep this contract with the SQL floor.
import 'server-only'

export const MAX_PROVIDER_TIMEOUT_MS = 120_000
export const AI_ADMISSION_TIMEOUT_MS = 15_000
export const AI_SETTLEMENT_TIMEOUT_MS = 30_000
export const AI_RESERVATION_FLOOR_MS = 5 * 60_000

export class AiDeadlineError extends Error {
  constructor() { super('AI operation timed out'); this.name = 'AiDeadlineError' }
}

/** Cancel the transport and bound the whole operation, even when it ignores cancellation. */
export async function withAiDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new AiDeadlineError()), timeoutMs)
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal) }), aborted])
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
