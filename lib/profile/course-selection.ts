// lib/profile/course-selection.ts — Whether the signed-in student's courses are set for the semester
// (get_my_course_selection(), 20261026100000_course_selection_lock.sql), and the profile revision a pass is bound to.
// The database is the authority: these reads only decide what a page shows; every save is still checked there.
import 'server-only'
import { isStudentRenderClient, readRenderStudentSession } from '@/lib/auth/render-session'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'] as const

const courseSelectionRow = z.object({
  state: z.enum(['incomplete', 'open', 'locked', 'reselect']),
  locked: z.boolean(),
  // Only while locked; null when no semester end is known yet.
  last_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export type CourseSelectionState = z.infer<typeof courseSelectionRow>['state']
export type CourseSelectionRead = { state: CourseSelectionState; locked: boolean; lastDay: string | null }

/** The student's own lock state, or null when it could not be read (the page then offers nothing it would refuse). */
export async function readCourseSelection(client: StudentClient): Promise<CourseSelectionRead | null> {
  try {
    const { data, error } = await client.rpc('get_my_course_selection')
    const parsed = courseSelectionRow.safeParse(data)
    if (error || !parsed.success) return null
    const { state, locked, last_day: lastDay } = parsed.data
    return { state, locked: locked && state === 'locked', lastDay: locked ? lastDay : null }
  } catch {
    return null
  }
}

/** The profile revision the student is looking at, which a pass activation is bound to (D7). */
export async function readProfileRevision(client: StudentClient, userId: string): Promise<number | null> {
  try {
    const context = isStudentRenderClient(client) ? await readRenderStudentSession(client) : undefined
    const { data, error } = context === undefined
      ? await client.from('profiles').select('revision').eq('id', userId).maybeSingle()
      : { data: context?.user.id === userId ? context.snapshot.profile : null, error: null }
    const parsed = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).safeParse(data)
    return error || !parsed.success ? null : parsed.data.revision
  } catch {
    return null
  }
}

/** A Lagos calendar day ('2027-03-08') as students read it ('8 March 2027'); empty when malformed. */
export function formatSemesterDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (match === null) return ''
  const [, year, month, date] = match
  const monthName = MONTHS[Number(month) - 1]
  return monthName === undefined ? '' : `${Number(date)} ${monthName} ${year}`
}
