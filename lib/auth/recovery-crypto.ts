// lib/auth/recovery-crypto.ts — Opaque recovery credentials and purpose-separated HMAC indexes.
import 'server-only'
import { createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { AUTH_INTERNAL_SECRET_MIN_BYTES } from './constants'

export const RECOVERY_GRANT_LIFETIME_SECONDS = 600
export const RECOVERY_GRANT_COOKIE = 'ci-recovery-grant'
export const RECOVERY_GRANT_PATH = '/api/auth'
const PURPOSE = 'campusintell:password-recovery:v2'
const CREDENTIAL_BYTES = 32
const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const identitySchema = z.object({ userId: z.string().uuid(), email: z.string().email() }).strict()
export type RecoveryIdentity = z.infer<typeof identitySchema>

/** Separate grant indexes from a non-reversible email binding used to prevent cross-tab identity mixing. */
export function recoveryDigest(value: string, domain: 'credential' | 'flow'): string {
  const secret = process.env.AUTH_INTERNAL_SECRET
  if (!secret || Buffer.byteLength(secret) < AUTH_INTERNAL_SECRET_MIN_BYTES) throw new Error('Recovery configuration unavailable')
  return createHmac('sha256', secret).update(JSON.stringify([PURPOSE, domain, value])).digest('hex')
}

/** Return a random cookie credential and token-free fields for the private grant record. */
export function makeRecoveryGrant(input: RecoveryIdentity) {
  const identity = identitySchema.parse(input)
  const credential = randomBytes(CREDENTIAL_BYTES).toString('base64url')
  return { credential, hash: recoveryDigest(credential, 'credential'), userId: identity.userId,
    binding: recoveryDigest(identity.email, 'flow') }
}

/** Validate cookie syntax before performing privileged work. */
export function isRecoveryCredential(value: unknown): value is string {
  return credentialSchema.safeParse(value).success
}
