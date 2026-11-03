// Each payment I/O operation has a real cancellation signal and a deadline, including test transports that ignore it.
import 'server-only'

export const PAYMENT_DATABASE_TIMEOUT_MS = 3_000
export const PAYMENT_CHECK_TIMEOUT_MS = 4_000
export const RECONCILE_START_BUDGET_MS = 40_000
export const RECONCILE_RUN_TIMEOUT_MS = 55_000

export class PaymentTimeoutError extends Error {
  constructor() { super('Payment operation timed out'); this.name = 'PaymentTimeoutError' }
}

/** Bound the whole operation (including response-body reads), and cancel its transport when time runs out. */
export async function withPaymentTimeout<T>(operation: (signal: AbortSignal) => PromiseLike<T>, milliseconds: number,
  parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new PaymentTimeoutError()), milliseconds)
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted()
      return operation(signal)
    }), aborted])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
