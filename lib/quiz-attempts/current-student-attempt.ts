import 'server-only'
import { z } from 'zod'
import type { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getCourseByContentKey } from '@/lib/data/courses'
import { attemptWriteSchema } from './input'
import type { AttemptWriteResult } from './input'
import { writeAttemptCommand } from './rpc'

const registrySchema = z.object({ id: z.string().uuid(), content_key: z.string().min(1) }).strict()

/** Legacy only (D10): save or finish an attempt an old tab opened before practice moved to the server. The database
 * accepts this only for a browser-run attempt younger than 24 hours, scores it from its pinned revisions and refuses
 * every start. Remove with app/api/quiz-attempts after that window. */
export async function writeCurrentStudentAttempt(
  input: unknown, response: NextResponse | undefined, pageToken: string | null,
): Promise<AttemptWriteResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = attemptWriteSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const command = parsed.data
    const course = getCourseByContentKey(command.courseContentKey)
    if (!course) return { status: 'invalid-request' }
    // Course UUIDs come from the content-key bridge, never the legacy Course.id or a caller UUID.
    const registry = await client.from('courses').select('id,content_key')
      .eq('content_key', course.contentKey).maybeSingle()
    if (registry.error) return { status: 'unavailable' }
    const row = registrySchema.safeParse(registry.data)
    if (!row.success || row.data.content_key !== course.contentKey) return { status: 'unavailable' }
    // SQL checks membership and derives correctness from the attempt's stored revisions.
    const answers = command.answers.map(answer => ({ question_id: answer.questionId,
      ordinal: answer.ordinal, option_index: answer.optionIndex }))

    // A refreshed/revoked/switched session must not authorize the earlier draft.
    const live = await getStudentSessionContext(response, client)
    if (live === null) return { status: 'signed-out' }
    if (live.user.id !== context.user.id || live.sessionId !== context.sessionId) {
      return { status: 'session-changed' }
    }
    const result = await writeAttemptCommand({
      p_session_id: live.sessionId, p_attempt_id: command.attemptId,
      p_course_id: row.data.id, p_question_count: 0,
      p_operation: command.operation, p_expected_revision: command.expectedRevision,
      p_status: command.operation === 'finish' ? command.completion : 'in_progress', p_answers: answers,
    })
    if (result.status === 'saved' && result.attempt.id !== command.attemptId) return { status: 'unavailable' }
    return result
  } catch { return { status: 'unavailable' } }
}
