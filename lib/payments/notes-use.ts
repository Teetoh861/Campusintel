// lib/payments/notes-use.ts — A notes topic the student has opened (scrolled into view on the course page), recorded as
// plan use for the refund rules. A best-effort background request: nothing on the page waits for it or changes with
// it. The database checks the course is readable and the item is one of its published notes.
import 'server-only'
import { z } from 'zod'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { createClient } from '@/lib/supabase/server'
import type { NextResponse } from 'next/server'
import { defaultPlanUseRecorder } from './plan-use'
import type { PlanUseRecorder } from './plan-use'

export const NOTE_OPENED_MAX_BYTES = 512
export const noteOpened = z.object({
  courseSlug: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  itemId: z.string().uuid(),
}).strict()
export type NoteOpened = z.infer<typeof noteOpened>
export type NoteOpenedResult = { status: 'recorded' | 'signed-out' | 'session-changed' | 'invalid-request' | 'not-found'
  | 'unavailable' }

/** Record one opened notes topic for this page's live session. */
export async function recordNoteOpened(input: unknown, response: NextResponse, pageToken: string | null,
  recordUse: PlanUseRecorder = defaultPlanUseRecorder()): Promise<NoteOpenedResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (!pageToken || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = noteOpened.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const course = await getStudentCourseBySlugForVerifiedStudent(client, parsed.data.courseSlug)
    if (course.status === 'signed-out') return { status: 'signed-out' }
    if (course.status !== 'ok' && course.status !== 'repository-only') {
      return { status: course.status === 'not-found' ? 'not-found' : 'unavailable' }
    }
    const recorded = await recordUse({ sessionId: context.sessionId, kind: 'notes-topic',
      courseId: course.course.repository.repositoryCourseId, ref: parsed.data.itemId })
    return { status: recorded ? 'recorded' : 'unavailable' }
  } catch { return { status: 'unavailable' } }
}
