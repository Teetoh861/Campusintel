// proxy.ts — Student Auth-boundary refresh only; public browsing and /admin stay independent.
import { refreshStudentSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

/** Refresh requests that cross a student Auth boundary without invoking admin authentication. */
export async function proxy(request: NextRequest) {
  return refreshStudentSession(request)
}

export const config = {
  matcher: [
    '/account/:path*',
    '/profile-selection',
    '/api/auth/:path*',
    '/login',
    '/register',
    '/confirm-email',
    '/forgot-password',
    '/reset-password',
    '/resend-confirmation',
  ],
}
