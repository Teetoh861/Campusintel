// lib/entitlements/service.ts — Phone-code trial activation for one verified student.
// Identity, phone uniqueness, rate limits, expiry and replay are decided by the database functions; this layer
// normalizes the phone, keeps the code and number out of the database, and talks to the SMS provider.
import 'server-only'
import { z } from 'zod'
import { codeHash, phoneHash } from './otp-crypto'
import { normalizeNigerianMobile } from './phone'
import { trialCodeMessage } from './sms'
import type { EntitlementCommand, EntitlementResult } from './contract'
import type { SmsConfig, SmsDelivery } from './sms'

const SMS_TIMEOUT_MS = 10_000
const DEFAULT_CODE_MINUTES = 10

const timestamp = z.string().min(1)
export const prepareRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), user_id: z.string().uuid(), expires_at: timestamp, resend_at: timestamp }),
  z.object({ state: z.enum(['cooldown', 'rate-limited']), retry_at: timestamp }),
  z.object({ state: z.literal('early-access-active'), available_from: timestamp }),
  z.object({ state: z.enum(['signed-out', 'already-activated', 'phone-already-used', 'capacity', 'trial-not-offered']) }),
])
export const verifyRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('activated'), ends_at: timestamp }),
  z.object({ state: z.literal('incorrect'), attempts_left: z.number().int().nonnegative() }),
  z.object({ state: z.literal('early-access-active'), available_from: timestamp }),
  z.object({ state: z.enum(['signed-out', 'invalid', 'already-used', 'superseded', 'too-many-attempts', 'expired',
    'already-activated', 'phone-already-used', 'trial-not-offered']) }),
])

export type PrepareRow = z.infer<typeof prepareRow>
export type VerifyRow = z.infer<typeof verifyRow>

export type EntitlementEnv = {
  /** Server-only HMAC key; null disables trial activation. */
  phoneKey: string | null
  sms: SmsConfig
  newChallengeId(): string
  newCode(): string
  now(): number
  /** Each returns null when the database answer was missing or malformed. */
  prepare(challengeId: string, phoneHash: string, phoneHint: string, codeHash: string): Promise<PrepareRow | null>
  recordDelivery(userId: string, challengeId: string, delivery: SmsDelivery): Promise<void>
  verify(challengeId: string, codeHash: string): Promise<VerifyRow | null>
  /** Private operator signal; never student-visible and never carries the number or code. */
  reportProblem(problem: 'sms-failed' | 'sms-error' | 'record-failed'): void
}

function codeMinutes(expiresAt: string, now: number): number {
  const minutes = Math.round((Date.parse(expiresAt) - now) / 60_000)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CODE_MINUTES
}

async function deliver(env: EntitlementEnv, to: string, body: string): Promise<SmsDelivery> {
  if (env.sms.status !== 'enabled') return 'failed'
  try {
    const delivery = await env.sms.provider.send(to, body, AbortSignal.timeout(SMS_TIMEOUT_MS))
    if (delivery === 'failed') env.reportProblem('sms-failed')
    return delivery
  } catch {
    // The provider may have accepted the message before the error, so it is counted as possibly delivered.
    env.reportProblem('sms-error')
    return 'unknown'
  }
}

async function sendTrialCode(env: EntitlementEnv, phoneInput: string): Promise<EntitlementResult> {
  // Fail closed before any database or provider work when sending is not configured.
  if (env.phoneKey === null || env.sms.status !== 'enabled') return { status: 'unavailable' }
  const phone = normalizeNigerianMobile(phoneInput)
  if (phone === null) return { status: 'invalid-phone' }
  const challengeId = env.newChallengeId()
  const code = env.newCode()
  const prepared = await env.prepare(challengeId, phoneHash(env.phoneKey, phone.e164), phone.hint,
    codeHash(env.phoneKey, challengeId, code))
  if (prepared === null) return { status: 'unavailable' }
  if (prepared.state === 'cooldown' || prepared.state === 'rate-limited') {
    return { status: prepared.state, retryAt: prepared.retry_at }
  }
  if (prepared.state === 'early-access-active') return { status: prepared.state, availableFrom: prepared.available_from }
  if (prepared.state !== 'ready') return { status: prepared.state }
  const delivery = await deliver(env, phone.e164, trialCodeMessage(code, codeMinutes(prepared.expires_at, env.now())))
  try { await env.recordDelivery(prepared.user_id, challengeId, delivery) }
  catch { env.reportProblem('record-failed') }
  if (delivery === 'failed') {
    return { status: 'delivery-failed', challengeId, phoneHint: phone.hint, resendAt: new Date(env.now()).toISOString() }
  }
  return { status: 'code-sent', challengeId, phoneHint: phone.hint, expiresAt: prepared.expires_at,
    resendAt: prepared.resend_at }
}

async function verifyTrialCode(env: EntitlementEnv, challengeId: string, code: string): Promise<EntitlementResult> {
  if (env.phoneKey === null) return { status: 'unavailable' }
  const verified = await env.verify(challengeId, codeHash(env.phoneKey, challengeId, code))
  if (verified === null) return { status: 'unavailable' }
  if (verified.state === 'activated') return { status: 'trial-activated', endsAt: verified.ends_at }
  if (verified.state === 'incorrect') return { status: 'incorrect', attemptsLeft: verified.attempts_left }
  if (verified.state === 'early-access-active') return { status: verified.state, availableFrom: verified.available_from }
  // An unknown challenge reads like an expired one; it never says whose it was.
  if (verified.state === 'invalid') return { status: 'expired' }
  return { status: verified.state }
}

/** Run one validated command for the verified student the environment is bound to. */
export function executeEntitlementCommand(env: EntitlementEnv, command: EntitlementCommand): Promise<EntitlementResult> {
  if (command.action === 'send-trial-code') return sendTrialCode(env, command.phone)
  return verifyTrialCode(env, command.challengeId, command.code)
}
