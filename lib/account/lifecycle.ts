import 'server-only'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'

const deadline = z.string().datetime({ offset: true })
const restricted = z.object({
  status: z.enum(['scheduled', 'expired']), deadline, requestId: z.string().uuid(),
}).strict()
const lifecycleSchema = z.union([
  z.object({ status: z.literal('active'), deletionAllowed: z.boolean() }).strict(),
  restricted,
  z.object({ status: z.literal('signed-out') }).strict(),
])
export type AccountLifecycle = z.infer<typeof lifecycleSchema>

/** Ask the database about this JWT's live session and lifecycle; never take a user ID. */
export async function readAccountLifecycle(client: Awaited<ReturnType<typeof createClient>>): Promise<AccountLifecycle> {
  const { data, error } = await client.rpc('read_account_lifecycle')
  if (error) throw new Error('Account lifecycle unavailable')
  return lifecycleSchema.parse(data)
}
