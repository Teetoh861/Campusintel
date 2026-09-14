// proxy.ts — Student refresh only; /admin retains its independent Server Component boundary.
import { refreshStudentSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

/** Refresh ordinary application requests without invoking custom admin authentication. */
export async function proxy(request: NextRequest) {
  return refreshStudentSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|admin(?:/|$)|api/admin(?:/|$)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
