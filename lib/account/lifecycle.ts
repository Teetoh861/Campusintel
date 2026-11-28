import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { lifecycleSchema } from './lifecycle-contract'
import type { AccountLifecycle } from './lifecycle-contract'
import { isStudentRenderClient, readRenderStudentSession } from '@/lib/auth/render-session'
import { authDeadline } from '@/lib/auth/deadline'
import { authUnavailable } from '@/lib/auth/unavailable'
export type { AccountLifecycle } from './lifecycle-contract'

/** Ask the database about this JWT's live session and lifecycle; never take a user ID. */
export async function readAccountLifecycle(client: Awaited<ReturnType<typeof createClient>>): Promise<AccountLifecycle> {
  if (isStudentRenderClient(client)) {
    const context = await readRenderStudentSession(client)
    return context?.snapshot.lifecycle ?? { status: 'signed-out' }
  }
  const { data, error } = await authDeadline(() => client.rpc('read_account_lifecycle'), 'identity')
  if (error) throw authUnavailable(error, 'identity')
  const parsed = lifecycleSchema.safeParse(data)
  if (!parsed.success) throw authUnavailable(null, 'identity')
  return parsed.data
}
