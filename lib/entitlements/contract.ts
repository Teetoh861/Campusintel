// lib/entitlements/contract.ts — The student entitlement summary and the commands that may cross the client boundary.
// Free courses never need an entitlement; full access is a server-issued grant (PRD v1.4 §4.5, §4.9). Early Access
// is granted automatically by the database, so no student command exists for it. A new 'trial' grant is the Discovery
// Pass (20261021100000_discovery_pass.sql): previews and a small AI allowance, never full access. A seven-day trial
// issued before that migration keeps its full access and is reported under `access` until it ends.
import { z } from 'zod'
import { discoveryKind } from './discovery-contract'

const timestamp = z.string().min(1)
const HOURS_PER_DAY = 24

export const TRIAL_POLICIES = ['seven-day', 'discovery'] as const
export type TrialPolicy = (typeof TRIAL_POLICIES)[number]

const discoverySummary = z.object({
  cbt_questions: z.number().int().positive(),
  ai_sets: z.number().int().nonnegative(),
  previews: z.array(z.object({ kind: discoveryKind, content_key: z.string().min(1), submitted: z.boolean() })),
})

// The database answer. Optional fields keep a rollout safe in both directions: this build reads a database from before
// 20261021100000 (trial_days only, no trial policy, no discovery), and that database's consumers keep reading this one.
const summaryWire = z.object({
  now: timestamp,
  // Informational only. Early Access never starts from the planned date.
  planned_launch_at: timestamp,
  // Set once by the founder; null until the platform has actually launched.
  actual_launch_at: timestamp.nullable(),
  // Length of a new trial, fixed by the database at activation. trial_days is the pre-Discovery field.
  trial_hours: z.number().int().positive().optional(),
  trial_days: z.number().int().positive().optional(),
  expiry_notice_hours: z.number().int().positive(),
  tier: z.enum(['full', 'free']),
  // Full access only: 'trial' here is a seven-day trial issued before the Discovery Pass, never a pass.
  access: z.object({ source: z.enum(['trial', 'early_access', 'manual', 'paid']), ends_at: timestamp }).nullable(),
  // after-early-access: none while Early Access is active; available_from says when it opens.
  trial: z.object({ status: z.enum(['available', 'active', 'ended', 'after-early-access', 'not-offered']),
    policy: z.enum(TRIAL_POLICIES).nullable().optional(),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), available_from: timestamp.nullable() }),
  // What a pass includes, and which previews it has used and on which course. No content is ever carried here.
  discovery: discoverySummary.optional(),
  // Automatic: awaiting-launch until the actual launch, then active for one month from enrollment.
  early_access: z.object({
    status: z.enum(['not-listed', 'awaiting-launch', 'pending', 'active', 'ended', 'enrollment-closed', 'unavailable',
      'account-restricted']),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), enrollment_closes_at: timestamp.nullable(),
  }),
  otp: z.object({ challenge_id: z.string().uuid(), phone_hint: z.string().regex(/^\d{3}$/), expires_at: timestamp,
    delivery: z.enum(['sent', 'failed']), resend_at: timestamp }).nullable(),
})

/**
 * The summary every page reads. `trial.policy` is null until a trial exists; a database from before the Discovery Pass
 * only ever issued seven-day trials and offers no pass, so `discovery` is null there.
 */
export const entitlementSummarySchema = summaryWire.transform((wire, context) => {
  const { trial_days: trialDays, trial_hours: trialHours, discovery, ...summary } = wire
  const hours = trialHours ?? (trialDays === undefined ? undefined : trialDays * HOURS_PER_DAY)
  if (hours === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'trial length missing', path: ['trial_hours'] })
    return z.NEVER
  }
  const legacy = discovery === undefined
  const policy: TrialPolicy | null = wire.trial.policy ?? (legacy && wire.trial.starts_at !== null ? 'seven-day' : null)
  return { ...summary, trial_hours: hours, trial: { ...wire.trial, policy }, discovery: legacy ? null : discovery }
})

export type EntitlementSummary = z.output<typeof entitlementSummarySchema>
export type DiscoverySummary = z.infer<typeof discoverySummary>
export type AccessSource = NonNullable<EntitlementSummary['access']>['source']

/** What one course offers this student now. `unknown` means the entitlement read failed: fail closed. */
export type CourseAccess = 'full' | 'free' | 'unknown'

// A trial code is six digits. Phone numbers are accepted in common Nigerian forms and normalized server-side.
export const OTP_CODE_LENGTH = 6
const PHONE_INPUT_MAX = 24

export const entitlementCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send-trial-code'), phone: z.string().min(1).max(PHONE_INPUT_MAX) }).strict(),
  z.object({ action: z.literal('verify-trial-code'), challengeId: z.string().uuid(),
    code: z.string().regex(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`)) }).strict(),
])

export type EntitlementCommand = z.infer<typeof entitlementCommandSchema>

const PLAIN_RESULTS = ['signed-out', 'session-changed', 'invalid-request', 'invalid-phone', 'unavailable', 'capacity',
  'already-activated', 'phone-already-used', 'expired', 'superseded', 'already-used', 'too-many-attempts',
  'trial-not-offered'] as const

export const entitlementResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('code-sent'), challengeId: z.string().uuid(), phoneHint: z.string().regex(/^\d{3}$/),
    expiresAt: timestamp, resendAt: timestamp }).strict(),
  z.object({ status: z.literal('delivery-failed'), challengeId: z.string().uuid(), phoneHint: z.string().regex(/^\d{3}$/),
    resendAt: timestamp }).strict(),
  z.object({ status: z.literal('cooldown'), retryAt: timestamp }).strict(),
  z.object({ status: z.literal('rate-limited'), retryAt: timestamp }).strict(),
  z.object({ status: z.literal('incorrect'), attemptsLeft: z.number().int().nonnegative() }).strict(),
  z.object({ status: z.literal('trial-activated'), endsAt: timestamp }).strict(),
  z.object({ status: z.literal('early-access-active'), availableFrom: timestamp }).strict(),
  ...PLAIN_RESULTS.map(status => z.object({ status: z.literal(status) }).strict()),
])

export type EntitlementResult = z.infer<typeof entitlementResultSchema>
export type EntitlementResultStatus = EntitlementResult['status']
