// lib/entitlements/client.ts — Browser calls for trial activation.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { entitlementResultSchema } from './contract'
import type { EntitlementCommand, EntitlementResult } from './contract'

// Sending a code waits for the SMS provider (up to 10 s) as well as the database.
const REQUEST_TIMEOUT_MS = 20_000

/** Post one command. Any transport or shape problem reads as `unavailable`; nothing is retried automatically. */
export async function postEntitlementCommand(command: EntitlementCommand, pageToken: string,
  request: typeof fetch = fetch): Promise<EntitlementResult> {
  try {
    const response = await request('/api/entitlements', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
      body: JSON.stringify(command),
    })
    const parsed = entitlementResultSchema.safeParse(await response.json())
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the student can try again. */ }
  return { status: 'unavailable' }
}
