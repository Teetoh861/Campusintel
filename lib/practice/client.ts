// lib/practice/client.ts — Browser calls for server-run practice.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { practiceResultSchema } from './contract'
import type { PracticeCommand, PracticeResult } from './contract'

// Each command is one database round trip.
const PRACTICE_TIMEOUT_MS = 10_000

/**
 * Post one practice command. A lost response is safe to repeat: a start names its own attempt id, so a retry returns
 * the attempt that start created; a save names its tab, sequence and revision, so the database applies it at most once
 * and never over a newer sheet; a submission returns the first grading. Saves are sent with keepalive, so one fired as
 * the page is being left still reaches the server.
 */
export async function postPracticeCommand(command: PracticeCommand, pageToken: string,
  request: typeof fetch = fetch): Promise<PracticeResult> {
  try {
    const response = await request('/api/practice', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(PRACTICE_TIMEOUT_MS),
      keepalive: command.action === 'save',
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
      body: JSON.stringify(command),
    })
    const parsed = practiceResultSchema.safeParse(await response.json())
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the caller retries what is safe to retry. */ }
  return { status: 'unavailable' }
}
