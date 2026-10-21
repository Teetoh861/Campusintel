// lib/entitlements/service.ts — One-click Discovery Pass activation for one verified student.
// The database decides identity, eligibility, the one-pass-per-account and one-pass-per-email rules, the Early Access
// overlap, the daily guard and the pass window (activate_discovery_pass in 20261021100000_discovery_pass.sql). This
// layer applies the request limit first and maps the database answer to the client contract. The keyed email claim
// hashes are computed by the caller (lib/entitlements/claim-hash.ts). No phone number, code or SMS exists anywhere in
// this flow.
import 'server-only'
import { z } from 'zod'
import type { EntitlementCommand, EntitlementResult } from './contract'

const timestamp = z.string().min(1)
export const activationRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('activated'), ends_at: timestamp }),
  z.object({ state: z.literal('already-activated'), ends_at: timestamp }),
  z.object({ state: z.literal('early-access-active'), available_from: timestamp }),
  z.object({ state: z.literal('already-claimed'), retention_months: z.number().int().positive() }),
  z.object({ state: z.enum(['signed-out', 'capacity', 'trial-not-offered']) }),
])
export type ActivationRow = z.infer<typeof activationRow>

export type EntitlementEnv = {
  /** The per-account and per-origin request limit. `limited` means the database is not asked at all. */
  limit(): Promise<'allowed' | 'limited'>
  /** Null when the database answer was missing or malformed. */
  activate(): Promise<ActivationRow | null>
}

async function activatePass(env: EntitlementEnv): Promise<EntitlementResult> {
  if (await env.limit() === 'limited') return { status: 'rate-limited' }
  const row = await env.activate()
  if (row === null) return { status: 'unavailable' }
  if (row.state === 'activated') return { status: 'pass-activated', endsAt: row.ends_at }
  if (row.state === 'already-activated') return { status: 'already-activated', endsAt: row.ends_at }
  if (row.state === 'early-access-active') return { status: row.state, availableFrom: row.available_from }
  if (row.state === 'already-claimed') return { status: row.state, retentionMonths: row.retention_months }
  return { status: row.state }
}

/** Run one validated command for the verified student the environment is bound to. */
export function executeEntitlementCommand(env: EntitlementEnv, command: EntitlementCommand): Promise<EntitlementResult> {
  // One command today; the switch keeps a future command from silently activating a pass.
  switch (command.action) {
    case 'activate-discovery-pass': return activatePass(env)
  }
}
