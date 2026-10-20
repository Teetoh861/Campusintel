// lib/entitlements/otp-crypto.ts — Keyed hashes for trial phones and codes. The database never sees either value.
import 'server-only'
import { createHmac, randomInt } from 'node:crypto'
import { OTP_CODE_LENGTH } from './contract'

type Env = Readonly<Record<string, string | undefined>>

// A 32-byte random secret, base64 or hex encoded, is at least this long.
const MIN_KEY_LENGTH = 32

/** The server-only HMAC key, or null when it is missing or too short. Trial activation is then unavailable. */
export function readPhoneHashKey(env: Env = process.env): string | null {
  const key = env.ENTITLEMENT_PHONE_HASH_KEY
  return key !== undefined && key.trim().length >= MIN_KEY_LENGTH ? key : null
}

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex')
}

export { phoneHash } from './phone'

/** A code hash is bound to its challenge, so a code from one challenge never verifies another. */
export function codeHash(key: string, challengeId: string, code: string): string {
  return hmac(key, `trial-code:${challengeId}:${code}`)
}

/** A uniformly random code from the CSPRNG. */
export function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0')
}
