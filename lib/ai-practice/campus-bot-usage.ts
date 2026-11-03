// lib/ai-practice/campus-bot-usage.ts — What is left of a student's Campus Bot limits, for part 3's usage bar. The
// database decides everything (get_my_campus_bot_usage, 20261103100000_campus_bot_limits.sql): the tier, the session
// and week windows, each opened by a request and ending at a time stored when it opened, and whether the next set can
// start. Tokens are Haiku-equivalent. A read that fails, or an answer we cannot read, is null: the page stays neutral.
import 'server-only'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const tokens = z.number().int().min(-100_000_000).max(100_000_000)
const window = z.object({ limit: tokens.nonnegative(), used: tokens.nonnegative(), in_flight: tokens.nonnegative(),
  left: tokens, resets_at: z.string().datetime({ offset: true }).nullable() }).strict()
const usageRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('tokens'), tier: z.enum(['standard', 'plus']), session: window, week: window,
    next_set_max: tokens.nonnegative(), can_start: z.boolean() }).strict(),
  // Trial and Discovery Pass sets are counted, not metered: the allowance summary describes them.
  z.object({ state: z.literal('units') }).strict(),
  z.object({ state: z.literal('not-entitled') }).strict(),
])

export type CampusBotWindow = { limit: number; used: number; inFlight: number; left: number; resetsAt: string | null }
export type CampusBotUsage =
  | { state: 'tokens'; tier: 'standard' | 'plus'; session: CampusBotWindow; week: CampusBotWindow; nextSetMax: number;
      canStart: boolean }
  | { state: 'units' | 'not-entitled' }

const windowFrom = (row: z.infer<typeof window>): CampusBotWindow => ({ limit: row.limit, used: row.used,
  inFlight: row.in_flight, left: row.left, resetsAt: row.resets_at })

/** The signed-in student's Campus Bot usage through their own session, or null when it cannot be read. */
export async function readCampusBotUsage(client: StudentClient): Promise<CampusBotUsage | null> {
  const { data, error } = await client.rpc('get_my_campus_bot_usage')
  if (error) return null
  const parsed = usageRow.safeParse(data)
  if (!parsed.success) return null
  const row = parsed.data
  if (row.state !== 'tokens') return { state: row.state }
  return { state: 'tokens', tier: row.tier, session: windowFrom(row.session), week: windowFrom(row.week),
    nextSetMax: row.next_set_max, canStart: row.can_start }
}
