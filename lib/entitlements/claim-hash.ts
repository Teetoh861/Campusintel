// lib/entitlements/claim-hash.ts — The keyed claim hash of a confirmed email address for the Discovery Pass ledger.
// The database stores only this HMAC (private.discovery_pass_claims), never the address, and never holds the key.
// Keys are versioned so they can be rotated: the first configured key signs new claims, every configured key is used
// to look up existing ones, and a retired key is dropped only once no live claim references its version
// (admin_discovery_claim_keys). Without a valid configuration activation is unavailable: fail closed.
import 'server-only'
import { createHmac } from 'node:crypto'

type Env = Readonly<Record<string, string | undefined>>

export type ClaimKey = { version: number; key: string }
export type ClaimKeys = { current: ClaimKey; all: ReadonlyArray<ClaimKey> }
export type ClaimHash = { version: number; hash: string }

// ENTITLEMENT_CLAIM_HASH_KEYS="<version>:<secret>,<version>:<secret>" with the current key first. A secret is at least
// 32 characters (openssl rand -base64 32); versions are distinct integers from 1 to 1000; at most 8 keys at once.
const ENTRY = /^([1-9]\d{0,3}):(.+)$/
const MIN_KEY_LENGTH = 32
const MAX_VERSION = 1000
const MAX_KEYS = 8
// Purpose-specific domain separation: a key reused elsewhere by mistake still cannot produce or verify a claim hash.
const PURPOSE = 'campusintell:discovery-pass-claim:v1'

/** Parse the configured keys, or null when anything is missing or malformed. */
export function readClaimHashKeys(env: Env = process.env): ClaimKeys | null {
  const raw = env.ENTITLEMENT_CLAIM_HASH_KEYS
  if (raw === undefined || raw.trim() === '') return null
  const entries = raw.split(',').map(entry => entry.trim())
  if (entries.length > MAX_KEYS) return null
  const keys: ClaimKey[] = []
  for (const entry of entries) {
    const match = ENTRY.exec(entry)
    if (match === null) return null
    const version = Number(match[1])
    const key = match[2]!
    if (version > MAX_VERSION || key.length < MIN_KEY_LENGTH || key !== key.trim()) return null
    if (keys.some(known => known.version === version)) return null
    keys.push({ version, key })
  }
  return keys.length === 0 ? null : { current: keys[0]!, all: keys }
}

/** The address as the ledger sees it: case and surrounding whitespace never make one address two claims. */
export function normalizeClaimEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** One hash per configured key, current first. The database inserts the first and matches any. */
export function claimHashes(keys: ClaimKeys, email: string): ClaimHash[] {
  const normalized = normalizeClaimEmail(email)
  return keys.all.map(({ version, key }) => ({ version,
    hash: createHmac('sha256', key).update(`${PURPOSE}:${normalized}`, 'utf8').digest('hex') }))
}
