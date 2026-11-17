// lib/campus-bot/client.ts — Browser calls for Explain and Ask Campus Bot.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { askResultSchema, explainResultSchema } from './contract'
import type { AskResult, CampusBotCommand, ExplainResult } from './contract'

// Longer than the server's own deadlines (an explanation and its check, or one reply), so the server always answers first.
const EXPLAIN_TIMEOUT_MS = 90_000
const ASK_TIMEOUT_MS = 45_000

async function post(command: CampusBotCommand, pageToken: string, timeoutMs: number, request: typeof fetch):
  Promise<unknown> {
  const response = await request('/api/campus-bot', {
    method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
    body: JSON.stringify(command),
  })
  return response.json()
}

/**
 * Ask for one explanation. Safe to repeat: an explanation already saved is returned again at no cost, and one still
 * being written answers `in-progress`.
 */
export async function requestExplanation(command: Extract<CampusBotCommand, { operation: 'explain' }>, pageToken: string,
  request: typeof fetch = fetch): Promise<ExplainResult> {
  try {
    const parsed = explainResultSchema.safeParse(await post(command, pageToken, EXPLAIN_TIMEOUT_MS, request))
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the caller offers Try again. */ }
  return { status: 'unavailable' }
}

/**
 * Send one chat message. Safe to repeat with the same requestId: a reply already delivered comes back at no cost for
 * a few minutes, and one still being written answers `in-progress`.
 */
export async function sendChatMessage(command: Extract<CampusBotCommand, { operation: 'ask' }>, pageToken: string,
  request: typeof fetch = fetch): Promise<AskResult> {
  try {
    const parsed = askResultSchema.safeParse(await post(command, pageToken, ASK_TIMEOUT_MS, request))
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the caller offers Try again with the same requestId. */ }
  return { status: 'unavailable' }
}
