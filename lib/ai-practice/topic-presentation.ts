// lib/ai-practice/topic-presentation.ts — The one line about a student's Campus Bot allowance that "Quiz me on this
// topic" shows: how many sets a free pass has left, before they are used. A plan or the free month shows nothing (its
// limits appear only when one is reached), and neither does a pass with nothing left (its tap says so).
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { AllowanceSummary } from './upload-contract'

export function quizPassLine(allowance: AllowanceSummary | null): string | null {
  // Only a free pass carries a source limit for its upload (get_my_ai_allowance): a trial grant from before the pass
  // is named differently, and is not offered this line.
  if (allowance === null || allowance.state !== 'active' || allowance.source !== 'trial' || allowance.total === null
      || allowance.sourceCharLimit === undefined) return null
  const left = Math.max(0, allowance.total - allowance.used)
  return left > 0 ? CAMPUS_BOT_COPY.quiz.passLeft(left, allowance.total) : null
}
