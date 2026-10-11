import 'server-only'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'
import type { AttemptWriteInput, AttemptWriteResult } from './input'

const storedStart = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), course_id: z.string().uuid(),
  question_count: z.number().int().positive().max(100),
  revision: z.number().int().nonnegative(),
  status: z.enum(['in_progress', 'submitted', 'timed_out']),
  finished_at: z.string().nullable(),
  quiz_attempt_questions: z.array(z.object({
    question_id: z.string().uuid(), ordinal: z.number().int().nonnegative(),
    content_revision: z.number().int().positive(),
  }).strict()).max(100),
}).strict()

/** Read-only recovery through live-account, owner-only RLS. Null means no owner-visible
 * attempt exists. Embedded rows share one database statement snapshot with metadata.
 * The caller must recheck live session continuity before acknowledging this result.
 */
export async function recoverExistingStart(
  client: Awaited<ReturnType<typeof createClient>>, userId: string, courseId: string,
  command: Extract<AttemptWriteInput, { operation: 'start' }>,
): Promise<AttemptWriteResult | null> {
  const result = await client.from('quiz_attempts')
    .select('id,user_id,course_id,question_count,status,revision,finished_at,quiz_attempt_questions(question_id,ordinal,content_revision)')
    .eq('id', command.attemptId).eq('user_id', userId).maybeSingle()
  if (result.error) return { status: 'unavailable' }
  if (result.data === null) return null
  const parsed = storedStart.safeParse(result.data)
  if (!parsed.success || parsed.data.id !== command.attemptId || parsed.data.user_id !== userId) {
    return { status: 'unavailable' }
  }
  const attempt = parsed.data
  const selected = [...attempt.quiz_attempt_questions].sort((a, b) => a.ordinal - b.ordinal)
  if (attempt.course_id !== courseId || attempt.question_count !== command.questions.length ||
      selected.length !== attempt.question_count || new Set(selected.map(q => q.question_id)).size !== selected.length ||
      selected.some((question, ordinal) => {
        const submitted = command.questions[ordinal]!
        return question.ordinal !== ordinal || submitted.ordinal !== ordinal ||
          question.question_id !== submitted.questionId || question.content_revision !== submitted.publishedRevision
      })) return { status: 'conflict' }
  if (attempt.status !== 'in_progress') return { status: 'finalized' }
  if (attempt.revision !== 0 || attempt.finished_at !== null) return { status: 'conflict' }
  return { status: 'saved', attempt: { id: attempt.id, revision: 0,
    status: 'in_progress', questionCount: attempt.question_count } }
}
