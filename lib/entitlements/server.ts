// lib/entitlements/server.ts — Server reads of the student's entitlement and the verified command entry point.
// get_my_entitlement() also enrolls an eligible Early Access member the database has not yet enrolled.
// Reads use the student's own cookie-bound client; every write is a service-role function given the verified
// session id, so the database derives the student itself (the same contract as AI practice and quiz attempts).
import 'server-only'
import { randomUUID } from 'node:crypto'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { track } from '@vercel/analytics/server'
import type { NextResponse } from 'next/server'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { PRODUCT_EVENTS } from '@/lib/analytics/product-events'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { entitlementCommandSchema, entitlementSummarySchema } from './contract'
import { generateCode, readPhoneHashKey } from './otp-crypto'
import { executeEntitlementCommand, prepareRow, verifyRow } from './service'
import { readSmsConfig } from './sms'
import type { CourseAccess, EntitlementResult, EntitlementSummary } from './contract'
import type { EntitlementEnv } from './service'

type StudentClient = Awaited<ReturnType<typeof createClient>>

// private.require_live_account() and get_my_entitlement() raise this when the session is no longer live.
const LIVE_SESSION_REQUIRED_CODE = '42501'

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

function createSupabaseEntitlementEnv(sessionId: string): EntitlementEnv {
  // Server-only client for the activation RPCs; mirrors lib/auth/rate-limit.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    phoneKey: readPhoneHashKey(),
    sms: readSmsConfig(),
    newChallengeId: randomUUID,
    newCode: generateCode,
    now: Date.now,
    async prepare(challengeId, hash, hint, code) {
      const { data, error } = await service.rpc('prepare_trial_otp', { p_session_id: sessionId,
        p_challenge_id: challengeId, p_phone_hash: hash, p_phone_hint: hint, p_code_hash: code })
      const parsed = prepareRow.safeParse(data)
      return error || !parsed.success ? null : parsed.data
    },
    async recordDelivery(userId, challengeId, delivery) {
      const { error } = await service.rpc('record_trial_otp_delivery', { p_user_id: userId,
        p_challenge_id: challengeId, p_delivery: delivery })
      if (error) throw new Error('Delivery record failed')
    },
    async verify(challengeId, code) {
      const { data, error } = await service.rpc('verify_trial_otp', { p_session_id: sessionId,
        p_challenge_id: challengeId, p_code_hash: code })
      const parsed = verifyRow.safeParse(data)
      return error || !parsed.success ? null : parsed.data
    },
    reportProblem(problem) {
      // Private operator signal: the failure class only. No number, code or student identity.
      console.error(`entitlements: ${problem}`)
    },
  }
}

/** Count a new trial. No identity, phone or header leaves the server. Early Access is granted in the database. */
async function recordGrant(result: EntitlementResult): Promise<void> {
  if (result.status !== 'trial-activated') return
  try { await track(PRODUCT_EVENTS.trialActivated, undefined, { headers: { 'user-agent': 'CampusIntel product events' } }) }
  catch { /* Analytics availability must never reverse a granted entitlement. */ }
}

/** Verify the live session and page continuity, then run one command for that student only. */
export async function runEntitlementRequest(input: unknown, response: NextResponse, pageToken: string | null):
  Promise<EntitlementResult> {
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
    const result = await executeEntitlementCommand(createSupabaseEntitlementEnv(context.sessionId), parsed.data)
    await recordGrant(result)
    return result
  } catch (error) {
    console.error('entitlements: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
