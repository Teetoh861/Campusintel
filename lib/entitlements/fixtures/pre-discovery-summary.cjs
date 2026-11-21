// lib/entitlements/fixtures/pre-discovery-summary.cjs — The entitlement summary schema exactly as builds before
// 20261021100000_discovery_pass.sql parse it (lib/entitlements/contract.ts at 9a4a2c3). Frozen so the rollout tests can
// prove a database with the Discovery Pass keeps answering application instances that are still running that build.
const { z } = require('zod')

const timestamp = z.string().min(1)

const preDiscoverySummarySchema = z.object({
  now: timestamp,
  planned_launch_at: timestamp,
  actual_launch_at: timestamp.nullable(),
  trial_days: z.number().int().positive(),
  expiry_notice_hours: z.number().int().positive(),
  tier: z.enum(['full', 'free']),
  access: z.object({ source: z.enum(['trial', 'early_access', 'manual', 'paid']), ends_at: timestamp }).nullable(),
  trial: z.object({ status: z.enum(['available', 'active', 'ended', 'after-early-access', 'not-offered']),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), available_from: timestamp.nullable() }),
  early_access: z.object({
    status: z.enum(['not-listed', 'awaiting-launch', 'pending', 'active', 'ended', 'enrollment-closed', 'unavailable',
      'account-restricted']),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), enrollment_closes_at: timestamp.nullable(),
  }),
  otp: z.object({ challenge_id: z.string().uuid(), phone_hint: z.string().regex(/^\d{3}$/), expires_at: timestamp,
    delivery: z.enum(['sent', 'failed']), resend_at: timestamp }).nullable(),
})

module.exports = { preDiscoverySummarySchema }
