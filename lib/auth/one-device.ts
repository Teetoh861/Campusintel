import 'server-only'
import { authDeadline } from './deadline'
import { authUnavailable } from './unavailable'
import type { createClient } from '@/lib/supabase/server'

/** End other devices only after a verified session has transferred. Tabs share the current cookie session. */
export async function endOtherStudentSessions(client: Awaited<ReturnType<typeof createClient>>, accessToken: string): Promise<void> {
  // Use the verified token explicitly. The session method swallows 401/403/404 logout failures; a sign-in must fail closed.
  const { error } = await authDeadline(() => client.auth.admin.signOut(accessToken, 'others'), 'provider')
  if (error) throw authUnavailable(error, 'provider')
}
