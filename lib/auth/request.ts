// lib/auth/request.ts — Same-origin, bounded JSON parsing and trusted requester address.
import 'server-only'
import { isIP } from 'node:net'
import { AUTH_BODY_MAX_BYTES, AUTH_MESSAGES } from './constants'
import { getAuthOrigin, isStudentAuthEnabled } from './config'
import type { ZodType } from 'zod'

export class AuthRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Reject disabled, cross-origin and malformed POSTs before any Supabase operation. */
export async function readAuthRequest<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (!isStudentAuthEnabled()) throw new AuthRequestError(503, AUTH_MESSAGES.unavailable)
  if (request.headers.get('origin') !== getAuthOrigin() ||
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
      if (length > AUTH_BODY_MAX_BYTES) {
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

/** Trust only Vercel's platform header, never an arbitrary forwarding chain.
 * Assumes direct Vercel ingress (no external trusted-proxy feature). Other production hosts fail closed.
 * https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
 */
export function getRequesterAddress(request: Request): string {
  if (process.env.VERCEL === '1') {
    const address = request.headers.get('x-vercel-forwarded-for')?.trim()
    if (!address || !isIP(address)) throw new AuthRequestError(503, AUTH_MESSAGES.unavailable)
    return isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address
  }
  if (process.env.NODE_ENV !== 'production') return 'local'
  throw new AuthRequestError(503, AUTH_MESSAGES.unavailable)
}
