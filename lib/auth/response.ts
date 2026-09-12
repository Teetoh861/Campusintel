// lib/auth/response.ts — Stable, private auth responses without provider error details.
import 'server-only'
import { NextResponse } from 'next/server'
import { AUTH_MESSAGES } from './constants'
import { AuthRequestError } from './request'

/** Return only an explicit application payload with cache and referrer protections. */
export function authJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'Pragma': 'no-cache', 'Expires': '0',
  } })
}

/** Map failures without serializing or logging provider errors or submitted secrets. */
export function authError(error: unknown): NextResponse {
  return error instanceof AuthRequestError
    ? authJson({ error: error.message }, error.status)
    : authJson({ error: AUTH_MESSAGES.unavailable }, 503)
}
