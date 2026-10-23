// lib/entitlements/server.ts — Server reads of the student's entitlement and the verified activation entry point.
// get_my_entitlement() also enrolls an eligible Early Access member the database has not yet enrolled. Whether a
// Discovery Pass may be offered at all is read here too, before any page renders, and fails closed.
// Reads use the student's own cookie-bound client; the activation write is a service-role function given the verified
// session id, so the database derives the student itself (the same contract as AI practice and quiz attempts).
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { track } from '@vercel/analytics/server'
import type { NextResponse } from 'next/server'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { PRODUCT_EVENTS } from '@/lib/analytics/product-events'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getBucket } from '@/lib/auth/rate-limit'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { claimHashes, readClaimHashKeys } from './claim-hash'
import { discoveryOffered, entitlementCommandSchema, entitlementSummarySchema } from './contract'
import { activationRow, eligibilityRow, executeEntitlementCommand } from './service'
import type { ClaimKeys } from './claim-hash'
import type { CourseAccess, EntitlementResult, EntitlementSummary } from './contract'
import type { EntitlementEnv } from './service'

type StudentClient = Awaited<ReturnType<typeof createClient>>

// private.require_live_account() and get_my_entitlement() raise this when the session is no longer live.
const LIVE_SESSION_REQUIRED_CODE = '42501'
// Activation requests: a hard limit per account (keyed by the confirmed email), and per-address monitoring only. The
// database holds the same figures and refuses any others (consume_discovery_activation_limit). A shared campus address
// is never a barrier: one noisy account can add at most its own five requests to the address's count, and crossing
// the notice threshold writes an audit row for the operator instead of refusing anyone.
export const ACTIVATION_LIMIT = { account: [5, 900], originNotice: [60, 900] } as const
const activationLimitRow = z.object({ allowed: z.boolean(), origin_requests: z.number().int().nonnegative() })

export type EntitlementRead =
  | { status: 'ok'; entitlement: EntitlementSummary }
  | { status: 'signed-out' | 'unavailable' }

function createServiceRoleClient() {
  // Server-only client for the service-role entitlement functions; mirrors lib/auth/rate-limit.ts.
  return createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Whether this student may be offered a Discovery Pass: the same rules activation applies (one pass per account, one
 * per confirmed address within the retention period, never after any Early Access, a key configuration that can
 * verify every claim), read without a lock. Missing keys, a session that cannot be verified, an error or a malformed
 * answer all mean false: no offer is shown that activation might refuse.
 */
async function readDiscoveryEligibility(client: StudentClient): Promise<boolean> {
  const keys = readClaimHashKeys()
  if (keys === null) return false
  try {
    const [{ data: userData, error: userError }, { data: claimsData, error: claimsError }] =
      await Promise.all([client.auth.getUser(), client.auth.getClaims()])
    const user = userData?.user
    const claims = claimsData?.claims
    if (userError || claimsError || !user?.email || claims?.sub !== user.id || typeof claims.session_id !== 'string'
      || !claims.session_id) return false
    const { data, error } = await createServiceRoleClient().rpc('discovery_pass_eligibility', {
      p_session_id: claims.session_id, p_claim_hashes: claimHashes(keys, user.email) })
    const parsed = eligibilityRow.safeParse(data)
    return !error && parsed.success && parsed.data.eligible
  } catch {
    return false
  }
}

/** The verified student's entitlement, read on the same client as the content it decides. */
export async function readEntitlementForVerifiedStudent(client: StudentClient): Promise<EntitlementRead> {
  try {
    const { data, error } = await client.rpc('get_my_entitlement')
    if (error) return { status: error.code === LIVE_SESSION_REQUIRED_CODE ? 'signed-out' : 'unavailable' }
    const parsed = entitlementSummarySchema.safeParse(data)
    if (!parsed.success) return { status: 'unavailable' }
    // Only a student the database could still give a pass is asked about; everyone else is simply not eligible.
    const askable = discoveryOffered(parsed.data) && parsed.data.trial.status === 'available'
    return { status: 'ok', entitlement: { ...parsed.data,
      discovery_eligible: askable && await readDiscoveryEligibility(client) } }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Full when a grant is active now, free otherwise; unknown when the read failed. */
export function courseAccessFrom(read: EntitlementRead): CourseAccess {
  if (read.status !== 'ok') return 'unknown'
  return read.entitlement.tier === 'full' ? 'full' : 'free'
}

function createSupabaseEntitlementEnv(sessionId: string, email: string, address: string, keys: ClaimKeys):
  EntitlementEnv {
  const service = createServiceRoleClient()
  return {
    async limit() {
      // The same purpose-separated buckets as the auth routes: the raw address and email never enter the database.
      const { data, error } = await service.rpc('consume_discovery_activation_limit', {
        p_account: getBucket('DISCOVERY_ACTIVATION', 'account', email.toLowerCase()),
        p_origin: getBucket('DISCOVERY_ACTIVATION', 'origin', address),
        p_account_limit: ACTIVATION_LIMIT.account[0], p_account_window: ACTIVATION_LIMIT.account[1],
        p_origin_notice: ACTIVATION_LIMIT.originNotice[0], p_origin_window: ACTIVATION_LIMIT.originNotice[1],
      })
      const parsed = activationLimitRow.safeParse(data)
      // A limiter outage fails closed: the request is not admitted without the limit.
      if (error || !parsed.success) throw new Error('Activation rate limit unavailable')
      return parsed.data.allowed ? 'allowed' : 'limited'
    },
    async activate() {
      // Only keyed hashes of the confirmed address reach the database, current key first.
      const { data, error } = await service.rpc('activate_discovery_pass', { p_session_id: sessionId,
        p_claim_hashes: claimHashes(keys, email) })
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
  // Fail closed before any session or database work when the claim key is not configured.
  const keys = readClaimHashKeys()
  if (keys === null) return { status: 'unavailable' }
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
    const env = createSupabaseEntitlementEnv(context.sessionId, context.user.email, address, keys)
    const result = await executeEntitlementCommand(env, parsed.data)
    await recordGrant(result)
    return result
  } catch (error) {
    console.error('entitlements: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
