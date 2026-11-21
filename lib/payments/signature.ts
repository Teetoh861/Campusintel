// lib/payments/signature.ts — Bachs webhook signatures (X-Bachs-Signature-V2: "t=<unix seconds>,v1=<hex>[,v1=<hex>]").
// Each v1 is HMAC-SHA256 of "{t}.{raw body}" under one signing secret. Bachs repeats v1 once per valid secret while a
// secret is rotated, and we hold up to two secrets ourselves (current and previous), so any v1 under any of our
// secrets is accepted. Comparison is constant-time; a stale or future timestamp beyond the tolerance is refused.
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-bachs-signature-v2'
export const SIGNATURE_TOLERANCE_SECONDS = 300
const HEX_DIGEST = /^[0-9a-f]{64}$/
const MAX_HEADER_LENGTH = 1024

export type SignatureCheck = { ok: true } | { ok: false; reason: 'malformed' | 'timestamp' | 'signature' }

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
}

/** Check a V2 header against the raw body (read before any parsing) and every configured secret. */
export function verifySignature(header: string | null, rawBody: string, secrets: readonly string[],
  nowSeconds: number = Math.floor(Date.now() / 1000)): SignatureCheck {
  if (header === null || header.length > MAX_HEADER_LENGTH || secrets.length === 0) return { ok: false, reason: 'malformed' }
  let timestamp: number | null = null
  const signatures: Buffer[] = []
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') {
      if (timestamp !== null || !/^\d{1,12}$/.test(value)) return { ok: false, reason: 'malformed' }
      timestamp = Number(value)
    } else if (key === 'v1' && HEX_DIGEST.test(value)) signatures.push(Buffer.from(value, 'hex'))
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: 'malformed' }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp' }
  // Every comparison runs, so timing reveals neither which secret nor which signature matched.
  let matched = false
  for (const secret of secrets) {
    const expected = Buffer.from(signPayload(secret, timestamp, rawBody), 'hex')
    for (const signature of signatures) if (timingSafeEqual(expected, signature)) matched = true
  }
  return matched ? { ok: true } : { ok: false, reason: 'signature' }
}

/** A V2 header for tests and the fake provider. */
export function signatureHeader(secrets: readonly string[], timestamp: number, rawBody: string): string {
  return [`t=${timestamp}`, ...secrets.map(secret => `v1=${signPayload(secret, timestamp, rawBody)}`)].join(',')
}
