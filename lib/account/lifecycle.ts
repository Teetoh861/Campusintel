import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { lifecycleSchema } from './lifecycle-contract'
import type { AccountLifecycle } from './lifecycle-contract'
import { isStudentRenderClient, readRenderStudentSession } from '@/lib/auth/render-session'
export type { AccountLifecycle } from './lifecycle-contract'

/** Ask the database about this JWT's live session and lifecycle; never take a user ID. */
export async function readAccountLifecycle(client: Awaited<ReturnType<typeof createClient>>): Promise<AccountLifecycle> {
  if (isStudentRenderClient(client)) {
    const context = await readRenderStudentSession(client)
    return context?.snapshot.lifecycle ?? { status: 'signed-out' }
  }
  const { data, error } = await client.rpc('read_account_lifecycle')
  if (error) throw new Error('Account lifecycle unavailable')
  return lifecycleSchema.parse(data)
}
