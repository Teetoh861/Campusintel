import { NextRequest, NextResponse } from 'next/server'
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifyPassword,
} from '@/lib/admin-auth'

// --- Rate limiting -------------------------------------------------------
//
// Simple in-memory, per-IP limiter: max 5 attempts per 15 minutes, then 429.
//
// NOTE: in-memory state resets on every redeploy and is per-instance (each
// serverless/Fluid instance keeps its own map), so this is best-effort, not a
// hard global guarantee. That is acceptable for this low-stakes single-password
// gate — a shared store (Redis/KV) backed limiter arrives with Era 2's real
// auth.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimitOk(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return false
  }
  entry.count += 1
  return true
}

// Read the client IP from the standard forwarded headers set by the platform.
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // First entry is the original client.
    return xff.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (!rateLimitOk(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429 }
    )
  }

  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    // Server misconfiguration — do not leak details, do not authenticate.
    return NextResponse.json({ error: 'Authentication is unavailable.' }, { status: 500 })
  }

  let submitted = ''
  try {
    const body = await req.json()
    if (body && typeof body.password === 'string') {
      submitted = body.password
    }
  } catch {
    submitted = ''
  }

  const ok = await verifyPassword(submitted, expected)
  if (!ok) {
    // Generic message — never reveal whether the password was close.
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  const token = await createSessionToken()
  const res = NextResponse.json({ success: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return res
}
