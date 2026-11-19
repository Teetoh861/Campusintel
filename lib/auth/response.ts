// lib/auth/response.ts — Stable, private auth responses without provider error details.
import 'server-only'
import { safeAuthMessage } from './errors'
import { NextResponse } from 'next/server'
import { AUTH_MESSAGES } from './constants'
import { AuthRequestError } from './request'
import { authUnavailableBody, authUnavailableReason, type AuthUnavailableContext } from './unavailable'

/** Return only an explicit application payload with cache and referrer protections. */
export function authJson(body: Record<string, unknown>, status = 200, unavailable?: AuthUnavailableContext): NextResponse {
  return NextResponse.json(authUnavailableBody(body, status, unavailable), { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'Pragma': 'no-cache', 'Expires': '0',
  } })
}

/** Map failures and log only the failed step, never provider errors or submitted secrets. */
export function authError(error: unknown, route = '/auth'): NextResponse {
  const unavailable = { route, reason: authUnavailableReason(error) }
  return error instanceof AuthRequestError
    ? authJson({ error: safeAuthMessage(error.message) }, error.status, unavailable)
    : authJson({ error: AUTH_MESSAGES.unavailable }, 503, unavailable)
}
