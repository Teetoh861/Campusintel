// lib/entitlements/contract.ts — The student entitlement summary and the commands that may cross the client boundary.
// Free courses never need an entitlement; full access is a server-issued grant (PRD v1.4 §4.5, §4.9). Early Access
// is granted automatically by the database, so no student command exists for it.
import { z } from 'zod'

const timestamp = z.string().min(1)

export const entitlementSummarySchema = z.object({
  now: timestamp,
  // Informational only. Early Access never starts from the planned date.
  planned_launch_at: timestamp,
  // Set once by the founder; null until the platform has actually launched.
  actual_launch_at: timestamp.nullable(),
  trial_days: z.number().int().positive(),
  expiry_notice_hours: z.number().int().positive(),
  tier: z.enum(['full', 'free']),
  access: z.object({ source: z.enum(['trial', 'early_access', 'manual', 'paid']), ends_at: timestamp }).nullable(),
  // after-early-access: no trial while Early Access is active; available_from says when it opens.
  trial: z.object({ status: z.enum(['available', 'active', 'ended', 'after-early-access', 'not-offered']),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), available_from: timestamp.nullable() }),
  // Automatic: awaiting-launch until the actual launch, then active for one month from enrollment.
  early_access: z.object({
    status: z.enum(['not-listed', 'awaiting-launch', 'pending', 'active', 'ended', 'enrollment-closed', 'unavailable',
      'account-restricted']),
    starts_at: timestamp.nullable(), ends_at: timestamp.nullable(), enrollment_closes_at: timestamp.nullable(),
  }),
  otp: z.object({ challenge_id: z.string().uuid(), phone_hint: z.string().regex(/^\d{3}$/), expires_at: timestamp,
    delivery: z.enum(['sent', 'failed']), resend_at: timestamp }).nullable(),
})

export type EntitlementSummary = z.infer<typeof entitlementSummarySchema>
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
