import 'server-only'
import { z } from 'zod'
import type { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { issueAccountContinuityToken, matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getCourseByContentKey } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getUsableCourseQuiz } from '@/lib/data/quiz-availability'
import { attemptWriteSchema } from './input'
import type { AttemptWriteResult } from './input'
import { writeAttemptCommand } from './rpc'
import type { CanonicalAnswer } from './rpc'

const registrySchema = z.object({ id: z.string().uuid(), content_key: z.string().min(1) }).strict()
const questionIdSchema = z.string().uuid()

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

/** Validate canonical quiz data and the same live session immediately before the atomic RPC. */
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
    const usable = getUsableCourseQuiz(course, getQuizByCourseSlug(course.slug))
    if (!usable) return { status: 'invalid-request' }

    const answers: CanonicalAnswer[] = []
    if (command.operation !== 'start') {
      if (command.answers.length > usable.attemptSize) return { status: 'invalid-request' }
      const seenQuestions = new Set<string>()
      const seenOrdinals = new Set<number>()
      for (const answer of command.answers) {
        const question = usable.quiz.questions.find(candidate => candidate.questionId === answer.questionId)
        if (!question || answer.ordinal >= usable.attemptSize || answer.optionIndex >= question.options.length ||
            seenQuestions.has(answer.questionId) || seenOrdinals.has(answer.ordinal)) {
          return { status: 'invalid-request' }
        }
        if (!questionIdSchema.safeParse(question.questionId).success ||
            !Number.isSafeInteger(question.correctAnswer) || question.correctAnswer < 0 ||
            question.correctAnswer >= question.options.length || !question.section) {
          return { status: 'unavailable' }
        }
        seenQuestions.add(answer.questionId)
        seenOrdinals.add(answer.ordinal)
        answers.push({ question_id: question.questionId, ordinal: answer.ordinal,
          option_index: answer.optionIndex, is_correct: answer.optionIndex === question.correctAnswer,
          section_label: question.section })
      }
    }

    // Course UUIDs come from the content-key bridge, never the legacy Course.id or a caller UUID.
    const registry = await client.from('courses').select('id,content_key')
      .eq('content_key', course.contentKey).maybeSingle()
    if (registry.error) return { status: 'unavailable' }
    const row = registrySchema.safeParse(registry.data)
    if (!row.success || row.data.content_key !== course.contentKey) return { status: 'unavailable' }

    // A refreshed/revoked/switched session must not authorize the earlier draft.
    const live = await getStudentSessionContext(response, client)
    if (live === null) return { status: 'signed-out' }
    if (live.user.id !== context.user.id || live.sessionId !== context.sessionId) {
      return { status: 'session-changed' }
    }
    const result = await writeAttemptCommand({
      p_session_id: live.sessionId, p_attempt_id: command.attemptId,
      p_course_id: row.data.id, p_question_count: usable.attemptSize,
      p_operation: command.operation,
      p_expected_revision: command.operation === 'start' ? null : command.expectedRevision,
      p_status: command.operation === 'finish' ? command.completion : 'in_progress', p_answers: answers,
    })
    if (result.status === 'saved' && (result.attempt.id !== command.attemptId ||
        result.attempt.questionCount !== usable.attemptSize)) return { status: 'unavailable' }
    return result
  } catch { return { status: 'unavailable' } }
}
