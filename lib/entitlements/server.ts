// lib/entitlements/server.ts — Server reads of the student's entitlement and the verified activation entry point.
// get_my_entitlement() also enrolls an eligible Early Access member the database has not yet enrolled.
// Reads use the student's own cookie-bound client; the activation write is a service-role function given the verified
// session id, so the database derives the student itself (the same contract as AI practice and quiz attempts).
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { track } from '@vercel/analytics/server'
import type { NextResponse } from 'next/server'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { PRODUCT_EVENTS } from '@/lib/analytics/product-events'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { consumeAuthLimit } from '@/lib/auth/rate-limit'
import { AuthRequestError } from '@/lib/auth/request'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { entitlementCommandSchema, entitlementSummarySchema } from './contract'
import { activationRow, executeEntitlementCommand } from './service'
import type { CourseAccess, EntitlementResult, EntitlementSummary } from './contract'
import type { EntitlementEnv } from './service'

type StudentClient = Awaited<ReturnType<typeof createClient>>

// private.require_live_account() and get_my_entitlement() raise this when the session is no longer live.
const LIVE_SESSION_REQUIRED_CODE = '42501'
const RATE_LIMITED_STATUS = 429

export type EntitlementRead =
  | { status: 'ok'; entitlement: EntitlementSummary }
  | { status: 'signed-out' | 'unavailable' }

/** The verified student's entitlement, read on the same client as the content it decides. */
export async function readEntitlementForVerifiedStudent(client: StudentClient): Promise<EntitlementRead> {
  try {
    const { data, error } = await client.rpc('get_my_entitlement')
    if (error) return { status: error.code === LIVE_SESSION_REQUIRED_CODE ? 'signed-out' : 'unavailable' }
    const parsed = entitlementSummarySchema.safeParse(data)
    return parsed.success ? { status: 'ok', entitlement: parsed.data } : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Full when a grant is active now, free otherwise; unknown when the read failed. */
export function courseAccessFrom(read: EntitlementRead): CourseAccess {
  if (read.status !== 'ok') return 'unknown'
  return read.entitlement.tier === 'full' ? 'full' : 'free'
}

function createSupabaseEntitlementEnv(sessionId: string, email: string, address: string): EntitlementEnv {
  // Server-only client for the activation RPC; mirrors lib/auth/rate-limit.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    async limit() {
      // The same purpose-separated buckets as the auth routes: the raw address and email never enter the database.
      try { await consumeAuthLimit('DISCOVERY_ACTIVATION', email.toLowerCase(), address) }
      catch (error) {
        if (error instanceof AuthRequestError && error.status === RATE_LIMITED_STATUS) return 'limited'
        throw error
      }
      return 'allowed'
    },
    async activate() {
      const { data, error } = await service.rpc('activate_discovery_pass', { p_session_id: sessionId })
      const parsed = activationRow.safeParse(data)
      return error || !parsed.success ? null : parsed.data
    },
  }
}

/** Count a new pass. No identity or header leaves the server. Early Access is granted in the database. */
async function recordGrant(result: EntitlementResult): Promise<void> {
  if (result.status !== 'pass-activated') return
  try { await track(PRODUCT_EVENTS.trialActivated, undefined, { headers: { 'user-agent': 'CampusIntel product events' } }) }
  catch { /* Analytics availability must never reverse a granted entitlement. */ }
}

/**
 * Verify the live session and page continuity, apply the request limit, then run one command for that student only.
 * `address` is the trusted requester address (lib/auth/request.ts getRequesterAddress) for the per-origin limit.
 */
export async function runEntitlementRequest(input: unknown, response: NextResponse, pageToken: string | null,
  address: string): Promise<EntitlementResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = entitlementCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    // A live student session always carries its confirmed address; without one nothing can be limited or claimed.
    if (!context.user.email) return { status: 'unavailable' }
    const env = createSupabaseEntitlementEnv(context.sessionId, context.user.email, address)
    const result = await executeEntitlementCommand(env, parsed.data)
    await recordGrant(result)
    return result
  } catch (error) {
    console.error('entitlements: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
