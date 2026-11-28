// Official feedback is returned only by the database reveal that records plan use in the same transaction.
import 'server-only'
import { z } from 'zod'
import { parsePublishedContentRows } from '@/lib/managed-content/published'
import { call } from '@/lib/payments/rpc'
import type { PaymentRpc } from '@/lib/payments/rpc'
import { createServiceRpc } from '@/lib/payments/server'
import { projectTheoryPractice } from './projection'
import type { TheoryFeedback } from './contract'

export type TheoryRevealInput = { sessionId: string; courseId: string; itemId: string; publishedRevision: number }
export type TheoryRevealResult = { status: 'ready'; feedback: TheoryFeedback }
  | { status: 'signed-out' | 'locked' | 'content-changed' | 'unavailable' }
export type TheoryRevealer = (input: TheoryRevealInput) => Promise<TheoryRevealResult>
const result = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), content: z.array(z.unknown()) }),
  z.object({ state: z.enum(['signed-out', 'locked', 'content-changed']) }),
])

/** Read the current feedback and its committed plan-use marker through one trusted RPC. */
export function theoryRevealer(rpc: PaymentRpc): TheoryRevealer {
  return async ({ sessionId, courseId, itemId, publishedRevision }) => {
    try {
      const answer = await call(rpc, 'reveal_theory_feedback', { p_session_id: sessionId, p_course_id: courseId,
        p_item_id: itemId, p_published_revision: publishedRevision }, result)
      if (answer.state !== 'ready') return { status: answer.state }
      const rows = parsePublishedContentRows(answer.content)
      if (rows === null || rows.some(row => row.course_id !== courseId)) return { status: 'unavailable' }
      const materials = projectTheoryPractice(rows)
      const material = materials?.length === 1 ? materials[0] : null
      if (material?.question.itemId !== itemId || material.question.publishedRevision !== publishedRevision
          || !material.feedback) return { status: 'unavailable' }
      return { status: 'ready', feedback: material.feedback }
    } catch { return { status: 'unavailable' } }
  }
}

/** Production wiring is created only when the validated student request reaches the reveal. */
export const revealTheoryFeedback: TheoryRevealer = async input => {
  try { return await theoryRevealer(createServiceRpc())(input) }
  catch { return { status: 'unavailable' } }
}
