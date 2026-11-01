// proxy.ts — Refresh the shared account session on every page and at the auth boundary.
import { refreshStudentSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

/** Refresh cookies and preserve lifecycle routing; render consumers share the verified identity and profile. */
export async function proxy(request: NextRequest) {
  return refreshStudentSession(request)
}

export const config = {
  // Every page, so a refreshed session is always saved and the first render knows the live session. Other API
  // handlers authenticate on their own; build output and files with an extension (icons, images) are skipped.
  matcher: [
    '/((?!api(?:/|$)|_next/|_vercel/|.*\\.[^/]+$).*)',
    '/api/auth/:path*',
  ],
}
