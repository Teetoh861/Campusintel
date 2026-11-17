// lib/entitlements/service.ts — The two student commands for one verified student: start a Discovery Pass, claim a
// free month (Early Access).
// The database decides identity, eligibility, the one-per-account and one-per-email rules, the daily guard, the claim
// window and every start and end time, on its own clock (activate_discovery_pass, last replaced in
// 20261103100000_campus_bot_limits.sql; claim_early_access, 20261116120000_early_access_claim.sql). This layer applies
// the request limit first and maps the database answer to the client contract. The keyed email claim hashes are
// computed by the caller (lib/entitlements/claim-hash.ts). No phone number, code, SMS, date or time is sent anywhere
// in this flow.
import 'server-only'
import { z } from 'zod'
import type { EntitlementCommand, EntitlementResult } from './contract'

const timestamp = z.string().min(1)
export const activationRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('activated'), ends_at: timestamp }),
  z.object({ state: z.literal('already-activated'), ends_at: timestamp }),
  z.object({ state: z.literal('early-access-active'), available_from: timestamp }),
  // retention_months is still sent for builds from before 20261023120000; this build never shows it.
  z.object({ state: z.literal('already-claimed'), retention_months: z.number().int().positive().optional() }),
  z.object({ state: z.enum(['signed-out', 'capacity', 'trial-not-offered', 'selection-changed']) }),
  // The claim-key configuration cannot verify every unexpired claim: nothing was decided (fail closed).
  z.object({ state: z.enum(['claim-key-missing', 'claim-key-replaced']) }),
])
export type ActivationRow = z.infer<typeof activationRow>

/** discovery_pass_eligibility(): whether this student may be offered a pass at all. Never a reason. */
export const eligibilityRow = z.object({ eligible: z.boolean() })

/** claim_early_access(): the month started, a replay of one already started, or a refusal. Never a reason. */
export const claimRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('claimed'), starts_at: timestamp, ends_at: timestamp }),
  // The account already has its one month. `active` says whether it is still running, on the database clock.
  z.object({ state: z.literal('already-claimed'), ends_at: timestamp, active: z.boolean() }),
  z.object({ state: z.enum(['signed-out', 'closed', 'not-available', 'needs-selection', 'selection-changed']) }),
  // The claim-key configuration cannot verify every unexpired claim: nothing was decided (fail closed).
  z.object({ state: z.enum(['claim-key-missing', 'claim-key-replaced']) }),
])
export type ClaimRow = z.infer<typeof claimRow>

/** early_access_claim_eligibility(): whether this student can claim now and, if so, when that month would end. */
export const freeMonthEligibilityRow = z.object({ eligible: z.boolean(), ends_at: timestamp.optional() })

export type EntitlementEnv = {
  /** The per-account request limit (the requester address is monitored, never a barrier). `limited` means the
   *  database is not asked at all. */
  limit(): Promise<'allowed' | 'limited'>
  /** Null when the database answer was missing or malformed. Bound to the profile revision when one is given. */
  activate(profileRevision?: number): Promise<ActivationRow | null>
  /** Null when the database answer was missing or malformed. Always bound to the profile revision the page showed. */
  claimFreeMonth(profileRevision: number): Promise<ClaimRow | null>
}

async function activatePass(env: EntitlementEnv, profileRevision: number | undefined): Promise<EntitlementResult> {
  if (await env.limit() === 'limited') return { status: 'rate-limited' }
  const row = await env.activate(profileRevision)
  if (row === null) return { status: 'unavailable' }
  if (row.state === 'activated') return { status: 'pass-activated', endsAt: row.ends_at }
  if (row.state === 'already-activated') return { status: 'already-activated', endsAt: row.ends_at }
  if (row.state === 'early-access-active') return { status: row.state, availableFrom: row.available_from }
  if (row.state === 'already-claimed') return { status: row.state }
  if (row.state === 'claim-key-missing' || row.state === 'claim-key-replaced') {
    // An operations fault, never the student's: ENTITLEMENT_CLAIM_HASH_KEYS dropped or changed a version that live
    // claims were written with. Surfaced for the operator; the student sees a plain "not available right now".
    console.error(`entitlements: activation refused, ${row.state} (see ops.cjs claim-keys)`)
    return { status: 'unavailable' }
  }
  return { status: row.state }
}

async function claimFreeMonth(env: EntitlementEnv, profileRevision: number): Promise<EntitlementResult> {
  if (await env.limit() === 'limited') return { status: 'rate-limited' }
  const row = await env.claimFreeMonth(profileRevision)
  if (row === null) return { status: 'unavailable' }
  switch (row.state) {
    case 'claimed': return { status: 'month-started', endsAt: row.ends_at }
    // A double tap, a second tab or a lost response: the month this account already has, never a second one. One that
    // has already ended or been withdrawn is simply not available again.
    case 'already-claimed': return row.active ? { status: 'month-started', endsAt: row.ends_at } : { status: 'offer-unavailable' }
    case 'closed': return { status: 'offer-ended' }
    case 'not-available': return { status: 'offer-unavailable' }
    // Either way the courses on the page are no longer the student's: the page loads again.
    case 'needs-selection':
    case 'selection-changed': return { status: 'selection-changed' }
    case 'signed-out': return { status: 'signed-out' }
    case 'claim-key-missing':
    case 'claim-key-replaced':
      // An operations fault, never the student's (see activatePass).
      console.error(`entitlements: free month claim refused, ${row.state} (see ops.cjs claim-keys)`)
      return { status: 'unavailable' }
  }
}

/** Run one validated command for the verified student the environment is bound to. */
export function executeEntitlementCommand(env: EntitlementEnv, command: EntitlementCommand): Promise<EntitlementResult> {
  // The switch keeps a future command from silently activating a pass or claiming a month.
  switch (command.action) {
    case 'activate-discovery-pass': return activatePass(env, command.profileRevision)
    case 'claim-free-month': return claimFreeMonth(env, command.profileRevision)
  }
}
