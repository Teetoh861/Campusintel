// proxy.ts — Refresh the shared account session at student and operator boundaries.
import { refreshStudentSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

/** Refresh account cookies; protected pages and handlers make their own authorization decisions. */
export async function proxy(request: NextRequest) {
  return refreshStudentSession(request)
}

export const config = {
  matcher: [
    '/account/:path*',
    '/dashboard/:path*',
    '/my-courses/:path*',
    '/profile-selection',
    '/courses/:path*',
    '/materials',
    '/bookmarks',
    '/admin/:path*',
    '/api/auth/:path*',
    '/login',
    '/register',
    '/confirm-email',
    '/forgot-password',
    '/reset-password',
    '/resend-confirmation',
  ],
}
