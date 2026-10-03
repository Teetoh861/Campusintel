import 'server-only'
import { z } from 'zod'
import type { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { issueAccountContinuityToken, matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getCourseByContentKey } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedCourse } from '@/lib/managed-content/published'
import { getUsableManagedQuiz } from '@/lib/managed-content/quiz'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import { attemptWriteSchema } from './input'
import type { AttemptWriteResult } from './input'
import { writeAttemptCommand } from './rpc'
import type { AttemptAnswer, AttemptSelection } from './rpc'

const registrySchema = z.object({ id: z.string().uuid(), content_key: z.string().min(1) }).strict()

/** Provide opaque page/session continuity for a future quiz caller, without user IDs. */
export async function getQuizAttemptContext(response?: NextResponse): Promise<
  { status: 'ready'; continuityToken: string } | { status: 'signed-out' | 'unavailable' }
> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const context = await getStudentSessionContext(response)
    return context === null ? { status: 'signed-out' } : {
      status: 'ready', continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId),
    }
  } catch { return { status: 'unavailable' } }
}

/** Validate live identity and delegate all scoring to the attempt's pinned managed revisions. */
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
    let questionCount = 0
    let answers: AttemptSelection[] | AttemptAnswer[]
    let publishedCourseId: string | null = null
    if (command.operation === 'start') {
      const published = await getPublishedManagedCourse(course.contentKey, response)
      if (published.status !== 'ok') return { status: published.status === 'signed-out' ? 'signed-out' : 'unavailable' }
      const projected = projectStudentLearning(published.content)
      if (projected.status !== 'ok') return { status: 'unavailable' }
      const usable = getUsableManagedQuiz(course.slug,
        getQuizConfigurationByCourseSlug(course.slug), projected.learning.quizQuestions)
      if (!usable) return { status: 'unavailable' }
      if (command.questions.length !== usable.attemptSize) return { status: 'invalid-request' }
      const liveQuestions = new Map(usable.questions.map(question => [question.questionId, question]))
      const seen = new Set<string>()
      for (let ordinal = 0; ordinal < command.questions.length; ordinal += 1) {
        const selection = command.questions[ordinal]!
        const live = liveQuestions.get(selection.questionId)
        if (!live || seen.has(selection.questionId) || selection.ordinal !== ordinal ||
            live.publishedRevision !== selection.publishedRevision) return { status: 'conflict' }
        seen.add(selection.questionId)
      }
      questionCount = usable.attemptSize
      publishedCourseId = published.courseId
      answers = command.questions.map(question => ({ question_id: question.questionId,
        ordinal: question.ordinal, content_revision: question.publishedRevision }))
    } else {
      // The current publication is irrelevant to an already-started attempt.
      // SQL checks membership and derives correctness from its stored revisions.
      answers = command.answers.map(answer => ({ question_id: answer.questionId,
        ordinal: answer.ordinal, option_index: answer.optionIndex }))
    }

    // Course UUIDs come from the content-key bridge, never the legacy Course.id or a caller UUID.
    const registry = await client.from('courses').select('id,content_key')
      .eq('content_key', course.contentKey).maybeSingle()
    if (registry.error) return { status: 'unavailable' }
    const row = registrySchema.safeParse(registry.data)
    if (!row.success || row.data.content_key !== course.contentKey) return { status: 'unavailable' }
    if (publishedCourseId !== null && publishedCourseId !== row.data.id) return { status: 'unavailable' }

    // A refreshed/revoked/switched session must not authorize the earlier draft.
    const live = await getStudentSessionContext(response, client)
    if (live === null) return { status: 'signed-out' }
    if (live.user.id !== context.user.id || live.sessionId !== context.sessionId) {
      return { status: 'session-changed' }
    }
    const result = await writeAttemptCommand({
      p_session_id: live.sessionId, p_attempt_id: command.attemptId,
      p_course_id: row.data.id, p_question_count: questionCount,
      p_operation: command.operation,
      p_expected_revision: command.operation === 'start' ? null : command.expectedRevision,
      p_status: command.operation === 'finish' ? command.completion : 'in_progress', p_answers: answers,
    })
    if (result.status === 'saved' && (result.attempt.id !== command.attemptId ||
        (command.operation === 'start' && result.attempt.questionCount !== questionCount))) {
      return { status: 'unavailable' }
    }
    return result
  } catch { return { status: 'unavailable' } }
}
