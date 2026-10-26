// lib/practice/progress.ts — Home's read of the student's own server-run practice: the open attempt to resume, the
// course last graded, and per course the questions given and the last score (practice_progress(),
// 20261027100000_home_practice_progress.sql). One call for every course, keyed by the verified session; the database
// derives the student. Never starts or saves anything; overdue attempts are graded there before it answers.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'

/** A course as practice knows it: the repository course id and its content key (its route on the static shelf). */
export type PracticeCourseRef = { courseId: string; contentKey: string }
export type CoursePracticeProgress = { practised: number; lastScore: { score: number; total: number } | null }

export type PracticeProgress =
  | { status: 'ok'; now: string; open: (PracticeCourseRef & { deadlineAt: string }) | null
      latest: PracticeCourseRef | null
      // Keyed by repository course id; a course never practised is absent.
      courses: ReadonlyMap<string, CoursePracticeProgress> }
  | { status: 'signed-out' | 'unavailable' }

const timestamp = z.string().min(1)
const count = z.number().int().nonnegative()
const courseRef = { course_id: z.string().uuid(), content_key: z.string().min(1) }
const dbProgress = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), now: timestamp,
    open: z.object({ ...courseRef, deadline_at: timestamp }).strict().nullable(),
    latest: z.object(courseRef).strict().nullable(),
    courses: z.array(z.object({ course_id: z.string().uuid(), practised: count, score: count.nullable(),
      total: z.number().int().positive().nullable() }).strict()) }).strict(),
  z.object({ state: z.literal('signed-out') }).strict(),
])

/** Map the database's answer; anything missing or malformed is `unavailable`, so home shows no figures at all. */
export function practiceProgressFrom(data: unknown): PracticeProgress {
  const parsed = dbProgress.safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }
  const row = parsed.data
  if (row.state === 'signed-out') return { status: 'signed-out' }
  const courses = new Map<string, CoursePracticeProgress>()
  for (const course of row.courses) {
    if (courses.has(course.course_id) || (course.score === null) !== (course.total === null) ||
        (course.score !== null && course.total !== null && course.score > course.total)) return { status: 'unavailable' }
    courses.set(course.course_id, { practised: course.practised,
      lastScore: course.score === null || course.total === null ? null : { score: course.score, total: course.total } })
  }
  return { status: 'ok', now: row.now,
    open: row.open && { courseId: row.open.course_id, contentKey: row.open.content_key, deadlineAt: row.open.deadline_at },
    latest: row.latest && { courseId: row.latest.course_id, contentKey: row.latest.content_key }, courses }
}

export type PracticeProgressEnv = { progress(): Promise<{ data: unknown; error: unknown }> }

function createSupabaseProgressEnv(sessionId: string): PracticeProgressEnv {
  // Server-only client, created per request (never shared between students); mirrors lib/practice/server.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { progress: async () => await service.rpc('practice_progress', { p_session_id: sessionId }) }
}

/** The verified session's practice summary for home. */
export async function readPracticeProgress(sessionId: string,
  env: PracticeProgressEnv = createSupabaseProgressEnv(sessionId)): Promise<PracticeProgress> {
  try {
    const { data, error } = await env.progress()
    return error ? { status: 'unavailable' } : practiceProgressFrom(data)
  } catch {
    return { status: 'unavailable' }
  }
}
