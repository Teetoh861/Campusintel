import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, verifySessionToken } from '@/lib/admin-auth'

// Runs on the Edge runtime. It uses lib/admin-auth.ts, which is built entirely
// on the Web Crypto API (crypto.subtle) — no Node-only imports — so signature
// verification works here as well as in the Node route handlers.
//
// We deliberately do NOT redirect. The /admin page is a Server Component that
// independently verifies the session and renders ONLY the login form when
// unauthenticated (so protected content is never sent to the client pre-auth).
// Middleware therefore just verifies the cookie for an early, cheap gate and
// passes the request through, letting the page be the single source of truth.
// The page re-verifies (fail closed) regardless of what middleware concludes.
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
  await verifySessionToken(token)
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
