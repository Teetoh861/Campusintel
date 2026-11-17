// lib/ai-practice/topic-client.ts — Browser calls for "Quiz me on this topic", and the request id each topic's quiz
// carries. The id is kept for this tab until the server reports an outcome it recorded against it, so a lost answer, a
// reload while the set is being written or a second tap replays the same request: it is never written, or charged,
// twice.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { topicSetResultSchema } from './topic-contract'
import type { TopicSetCommand, TopicSetResult } from './topic-contract'

// Longer than the server's own bound on one request (admission, writing, the check and settlement: 195 s).
const TOPIC_SET_TIMEOUT_MS = 210_000

/** Ask for one set. Safe to repeat with the same requestId. */
export async function requestTopicSet(command: TopicSetCommand, pageToken: string, request: typeof fetch = fetch):
  Promise<TopicSetResult> {
  try {
    const response = await request('/api/ai-practice', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(TOPIC_SET_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
      body: JSON.stringify(command),
    })
    const parsed = topicSetResultSchema.safeParse(await response.json())
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the caller offers Try again with the same requestId. */ }
  return { status: 'unavailable' }
}

/** The part of Storage the request ids use; tests pass a stand-in. */
export type RequestIdStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY_PREFIX = 'campus-bot-quiz:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Outcomes recorded against the request id: repeating that id would only replay them, so the next tap is a new request.
const RECORDED: ReadonlySet<TopicSetResult['status']> = new Set(['ready', 'failed', 'invalid-request'])

function sessionStore(): RequestIdStore | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

/**
 * The request id for a topic's quiz: the one this tab is still waiting on, or a new one. A store that cannot be read
 * or written (a private window, blocked storage) only loses the reuse across reloads; the page still works.
 */
export function topicRequestId(itemId: string, newId: () => string, store: RequestIdStore | null = sessionStore()):
  string {
  const key = KEY_PREFIX + itemId
  try {
    const kept = store?.getItem(key) ?? null
    if (kept !== null && UUID.test(kept)) return kept
  } catch { /* Unreadable: start a new request. */ }
  const requestId = newId()
  try { store?.setItem(key, requestId) } catch { /* Kept for this page view only. */ }
  return requestId
}

/** Forget the id once the server has recorded an outcome against it. Any other result keeps it for a retry. */
export function settleTopicRequest(itemId: string, result: TopicSetResult,
  store: RequestIdStore | null = sessionStore()): void {
  if (!RECORDED.has(result.status)) return
  try { store?.removeItem(KEY_PREFIX + itemId) } catch { /* Nothing to forget. */ }
}
