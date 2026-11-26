// Per-course authorization, on the verified student's cookie-bound client. Never infer it from a global plan tier.
import 'server-only'
import { z } from 'zod'
import { isTesterSite } from '@/lib/tester/site.cjs'
import type { createClient } from '@/lib/supabase/server'

const MAX_COURSES = 200
const row = z.object({
  institutional_course_id: z.string().uuid(),
  allowed: z.boolean(),
  // 'tester': owner tester access (supabase/migrations/20261125200000_owner_tester_access.sql), honoured only on the
  // test site; anywhere else the whole read fails closed.
  reason: z.enum(['free', 'operator', 'own-list', 'team-added', 'tester', 'needs-plan', 'outside-list',
    'needs-selection', 'missing-calendar', 'unavailable']),
  on_list: z.boolean(),
  team_added: z.boolean(),
  ends_at: z.string().nullable(),
}).strict()

export type CourseDecision = z.infer<typeof row>
export type CourseAccessRead =
  | { status: 'ok'; decisions: ReadonlyMap<string, CourseDecision> }
  | { status: 'signed-out' | 'unavailable'; testerOffSite?: true }

/** Read only bounded course decisions for the live session owner; malformed or incomplete answers fail closed. */
export async function getCourseAccessForVerifiedStudent(
  client: Awaited<ReturnType<typeof createClient>>, courseIds: readonly string[],
): Promise<CourseAccessRead> {
  const ids = [...new Set(courseIds)]
  if (ids.length === 0) return { status: 'ok', decisions: new Map() }
  if (ids.length > MAX_COURSES || ids.some(id => !z.string().uuid().safeParse(id).success)) return { status: 'unavailable' }
  try {
    const { data, error } = await client.rpc('get_my_course_access', { p_institutional_course_ids: ids })
    if (error) return { status: error.code === '42501' ? 'signed-out' : 'unavailable' }
    const parsed = row.array().safeParse(data)
    if (!parsed.success || parsed.data.length !== ids.length) return { status: 'unavailable' }
    const decisions = new Map(parsed.data.map(item => [item.institutional_course_id, item]))
    // Tester access read by a server that is not on the test site: refused, and named, so course readers refuse too.
    if (!isTesterSite() && parsed.data.some(item => item.reason === 'tester')) return { status: 'unavailable', testerOffSite: true }
    const allowedReasons = ['free', 'operator', 'own-list', 'team-added', 'tester']
    if (decisions.size !== ids.length || ids.some(id => !decisions.has(id)) || parsed.data.some(item =>
      item.allowed !== allowedReasons.includes(item.reason))) return { status: 'unavailable' }
    return { status: 'ok', decisions }
  } catch { return { status: 'unavailable' } }
}
