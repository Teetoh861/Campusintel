import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { theoryFeedback } from './contract'
import type { TheorySubmission, TheorySubmitResult } from './contract'

const THEORY_REQUEST_TIMEOUT_MS = 10000

/** Request published feedback for one question; the student's draft never leaves the page. */
export async function revealTheoryAnswer(
  command: TheorySubmission, pageToken: string, signal: AbortSignal, request: typeof fetch = fetch,
): Promise<TheorySubmitResult> {
  // Copy only the identity fields so no extra caller property can reach the request.
  const { courseSlug, itemId, publishedRevision } = command
  try {
    const response = await request('/api/theory-practice', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      signal: AbortSignal.any([signal, AbortSignal.timeout(THEORY_REQUEST_TIMEOUT_MS)]),
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
      body: JSON.stringify({ courseSlug, itemId, publishedRevision }),
    })
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('status' in body)) return { status: 'unavailable' }
    if (response.ok && body.status === 'ready' && 'feedback' in body) {
      const feedback = theoryFeedback.safeParse(body.feedback)
      if (feedback.success && feedback.data.question.itemId === itemId &&
          feedback.data.question.publishedRevision === publishedRevision) {
        return { status: 'ready', feedback: feedback.data }
      }
    }
    if (body.status === 'signed-out' || body.status === 'session-changed' || body.status === 'incomplete' ||
        body.status === 'invalid-request' || body.status === 'not-found' || body.status === 'content-changed') {
      return { status: body.status }
    }
  } catch { /* Keep the draft available for retry after a timeout or network failure. */ }
  return { status: 'unavailable' }
}
