// app/courses/[slug]/quiz/liveBank.ts — Validate a fresh private managed bank before a new attempt.
import { z } from 'zod'
import type { ManagedQuiz } from '@/lib/managed-content/quiz'

const question = z.object({
  id: z.number().int().positive(), questionId: z.string().uuid(),
  question: z.string().min(1), options: z.array(z.string()).min(2),
  correctAnswer: z.number().int().nonnegative(), section: z.string().min(1),
  explanation: z.string().optional(), publishedRevision: z.number().int().positive(),
}).strict().refine(value => value.correctAnswer < value.options.length)
const result = z.object({ status: z.literal('ready'), quiz: z.object({
  href: z.string(), bankSize: z.number().int().positive(),
  attemptSize: z.number().int().positive(), timerSeconds: z.number().positive(),
  maxQuestions: z.number().int().positive(), sections: z.array(z.string().min(1)),
  questions: z.array(question).min(1),
}).strict() }).strict()

/** Get a current published bank for each new attempt, including a retake. */
export async function loadFreshQuiz(slug: string): Promise<ManagedQuiz | null> {
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(slug)}/quiz-bank`, {
      cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return null
    const parsed = result.safeParse(await response.json())
    if (!parsed.success || parsed.data.quiz.bankSize !== parsed.data.quiz.questions.length ||
        parsed.data.quiz.attemptSize !== Math.min(parsed.data.quiz.maxQuestions, parsed.data.quiz.bankSize)) {
      return null
    }
    return parsed.data.quiz
  } catch { return null }
}
