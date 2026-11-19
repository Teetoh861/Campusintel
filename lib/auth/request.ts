// lib/auth/request.ts — Same-origin, bounded JSON parsing and trusted requester address.
import 'server-only'
import { isIP } from 'node:net'
import { AUTH_API, AUTH_BODY_MAX_BYTES, AUTH_MESSAGES } from './constants'
import { getAuthOrigin, isStudentAuthEnabled, isTrustedAuthOrigin } from './config'
import { AuthUnavailableError, logUnknownRequester } from './unavailable'
import type { ZodType } from 'zod'

export class AuthRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Reject disabled, cross-origin and malformed POSTs before any Supabase operation. */
export async function readAuthRequest<T>(
  request: Request, schema: ZodType<T>, options: { maxBytes?: number } = {},
): Promise<T> {
  const maxBytes = options.maxBytes ?? AUTH_BODY_MAX_BYTES
  if (!isStudentAuthEnabled()) throw new AuthUnavailableError('configuration')
  if (!isTrustedAuthOrigin(request.headers.get('origin')) ||
      ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '')) {
    throw new AuthRequestError(403, 'This request could not be accepted.')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthRequestError(415, AUTH_MESSAGES.invalid)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new AuthRequestError(400, AUTH_MESSAGES.invalid)
  let length = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new AuthRequestError(413, AUTH_MESSAGES.invalid)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const result = schema.safeParse(parsed)
    if (!result.success) throw new AuthRequestError(400, AUTH_MESSAGES.invalid)
    return result.data
  } catch (error) {
    if (error instanceof AuthRequestError) throw error
    throw new AuthRequestError(400, AUTH_MESSAGES.invalid)
  } finally { reader.releaseLock() }
}

/** Trust only Vercel's platform header, taking the first valid address in its list.
 * Missing/invalid platform addresses share one stricter rate-limit bucket.
 * Assumes direct Vercel ingress (no external trusted-proxy feature). Non-Vercel production
 * permits the local bucket only for an explicitly configured loopback canonical origin.
 * https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
 */
export function getRequesterAddress(request: Request): string {
  if (process.env.VERCEL === '1') {
    const header = request.headers.get('x-vercel-forwarded-for')
    const shape = !header?.trim() ? 'missing' : header.includes(',') ? 'list' : 'invalid'
    const pathname = new URL(request.url).pathname
    // Only known static paths may enter logs, never a submitted path or query.
    const route = [...Object.values(AUTH_API), '/api/entitlements'].find(path => path === pathname) ?? '/api/auth'
    for (const candidate of header?.split(',') ?? []) {
      const address = candidate.trim()
      if (isIP(address) === 4) return address
      if (isIP(address) === 6) {
        try { return new URL(`http://[${address}]/`).hostname.slice(1, -1) } catch { /* Try the next address. */ }
      }
    }
    logUnknownRequester(route, shape)
    return 'unknown'
  }
  if (process.env.NODE_ENV !== 'production') return 'local'
  try {
    const hostname = new URL(getAuthOrigin()).hostname
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return 'local'
  } catch { /* Invalid canonical configuration must fail closed. */ }
  throw new AuthUnavailableError('configuration')
}
