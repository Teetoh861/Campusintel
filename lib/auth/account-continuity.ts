// lib/auth/account-continuity.ts — Compare a live session with the account that rendered a page.
import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAuthSecretKey } from './config'

const PURPOSE = 'student-session-continuity:v2'
const TOKEN_FORMAT = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/

function signature(nonce: string, userId: string, sessionId: string): Buffer {
  return createHmac('sha256', getAuthSecretKey())
    .update(JSON.stringify([PURPOSE, nonce, userId, sessionId]))
    .digest()
}

/** Issue a page-specific, non-authorizing token for a live server-session user. */
export function issueAccountContinuityToken(userId: string, sessionId: string): string {
  const nonce = randomBytes(16).toString('base64url')
  return `${nonce}.${signature(nonce, userId, sessionId).toString('base64url')}`
}

/** Compare only after remote validation of the current user and session claims. */
export function matchesAccountContinuityToken(token: string, userId: string, sessionId: string): boolean {
  const parts = TOKEN_FORMAT.exec(token)
  if (!parts) return false
  const nonce = Buffer.from(parts[1], 'base64url')
  const received = Buffer.from(parts[2], 'base64url')
  // Node decodes non-zero unused bits; accept only the exact encoding we issue.
  if (nonce.toString('base64url') !== parts[1] || received.toString('base64url') !== parts[2]) return false
  const expected = signature(parts[1], userId, sessionId)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
