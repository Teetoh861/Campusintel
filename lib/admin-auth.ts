// Admin session signing/verification utilities.
//
// SERVER-ONLY. This module reads ADMIN_SESSION_SECRET / ADMIN_PASSWORD from
// the environment and must never be imported into a Client Component. It is
// used from Route Handlers (Node runtime), Middleware (Edge runtime) and the
// /admin Server Component.
//
// Everything here is built on the Web Crypto API (crypto.subtle, btoa/atob,
// TextEncoder) so the exact same code runs in both the Node and Edge runtimes.
// Do NOT introduce `node:crypto` or other Node-only imports here — that would
// break the Edge middleware.

export const COOKIE_NAME = 'ci_admin_session'

// Session lifetime: 24 hours.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24

interface SessionPayload {
  // Expiry, seconds since epoch.
  exp: number
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not set')
  }
  return secret
}

// --- base64url helpers (URL/cookie-safe, no padding) ---------------------

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// --- HMAC-SHA256 (Web Crypto) --------------------------------------------

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

// Constant-time byte comparison. Runs over the full length of the inputs and
// only short-circuits on a length mismatch (which is not secret). Equivalent
// in intent to crypto.timingSafeEqual, but Edge-compatible.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

// --- Public API ----------------------------------------------------------

// Create a signed session token of the form:
//   base64url(payload).base64url(HMAC-SHA256(payload))
// The payload carries a 24h-out expiry timestamp.
export async function createSessionToken(): Promise<string> {
  const secret = getSecret()
  const payload: SessionPayload = { exp: nowSeconds() + SESSION_MAX_AGE_SECONDS }
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmac(secret, payloadB64)
  const sigB64 = base64urlEncode(sig)
  return `${payloadB64}.${sigB64}`
}

// Verify a session token: recompute the HMAC over the payload, compare it to
// the provided signature in constant time, then check the expiry. Fails closed
// on any parse/verify error. Returns true only for a well-formed, correctly
// signed, unexpired token.
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  try {
    if (!token) return false
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payloadB64, sigB64] = parts
    if (!payloadB64 || !sigB64) return false

    const secret = getSecret()
    const expectedSig = await hmac(secret, payloadB64)
    const providedSig = base64urlDecode(sigB64)
    if (!timingSafeEqual(expectedSig, providedSig)) return false

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64))
    ) as SessionPayload
    if (typeof payload.exp !== 'number') return false
    if (nowSeconds() >= payload.exp) return false

    return true
  } catch {
    // Fail closed on malformed base64, bad JSON, missing secret, etc.
    return false
  }
}

// Constant-time password check. Both the submitted and expected passwords are
// first HMAC'd to fixed-length digests, so neither the comparison duration nor
// the length of the real password leaks (a plain `===` early-exits on the
// first differing character and reveals length). Uses the session secret as
// the HMAC key purely to produce comparable fixed-length digests.
export async function verifyPassword(submitted: string, expected: string): Promise<boolean> {
  const secret = getSecret()
  const a = await hmac(secret, submitted)
  const b = await hmac(secret, expected)
  return timingSafeEqual(a, b)
}
