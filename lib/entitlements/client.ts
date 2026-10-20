// lib/entitlements/client.ts — Browser calls for Discovery Pass activation and previews.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { entitlementResultSchema } from './contract'
import { discoveryResultSchema } from './discovery-contract'
import type { EntitlementCommand, EntitlementResult } from './contract'
import type { DiscoveryCommand, DiscoveryResult } from './discovery-contract'

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

// Opening or grading a preview is one database round trip.
const DISCOVERY_TIMEOUT_MS = 10_000

/** Post one preview command. A lost response is safe to repeat: the server returns the same preview or grading. */
export async function postDiscoveryCommand(command: DiscoveryCommand, pageToken: string,
  request: typeof fetch = fetch): Promise<DiscoveryResult> {
  try {
    const response = await request('/api/discovery', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken },
      body: JSON.stringify(command),
    })
    const parsed = discoveryResultSchema.safeParse(await response.json())
    if (parsed.success) return parsed.data
  } catch { /* Network failure or timeout: the student can try again. */ }
  return { status: 'unavailable' }
}
