import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'

export class QuizRequestError extends Error {
  constructor(readonly signedOut: boolean, message: string, readonly status?: number) { super(message) }
}
/** Fetch a bounded private response; cancellation never implies a mutation was rolled back. */
export async function quizRequest(path: string, body?: object, token?: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort',cancel,{ once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(cancel,6_000)
  try {
    const response = await fetch(path,{ method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal, headers: body ? { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: token ?? '' } : undefined,
      body: body ? JSON.stringify(body) : undefined })
    const value: unknown = await response.json()
    if (!response.ok) throw new QuizRequestError(response.status === 401,response.status === 401 ? 'Sign in to continue.' :
      response.status === 409 ? 'Reload this page to continue.' : 'We couldn’t reach the quiz. Try again.',response.status)
    return value
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel) }
}
