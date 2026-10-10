import 'server-only'
import type { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { questionReportInput, questionReportResult } from './input'
import type { QuestionReportResult } from './input'

/** Submit as the live cookie-bound account; SQL derives auth.uid() and canonical context. */
export async function submitCurrentStudentReport(
  input: unknown, response: NextResponse, pageToken: string | null,
): Promise<QuestionReportResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = questionReportInput.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const command = parsed.data
    const { data, error } = await client.rpc('submit_question_report', {
      p_course_id: command.courseId, p_item_id: command.itemId, p_content_revision: command.revision,
      p_question_id: command.questionId, p_attempt_id: command.attemptId, p_note: command.note,
    })
    if (error?.code === '22023') return { status: 'invalid-request' }
    if (error?.code === '42501') return { status: 'signed-out' }
    if (error) return { status: 'unavailable' }
    const result = questionReportResult.safeParse(data)
    return result.success ? result.data : { status: 'unavailable' }
  } catch { return { status: 'unavailable' } }
}
