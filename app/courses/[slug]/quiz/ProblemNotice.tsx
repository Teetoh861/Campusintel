// app/courses/[slug]/quiz/ProblemNotice.tsx — A start or resume problem, with Try again when trying again can help.
import { btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PRACTICE_COPY } from './practice-presentation'
import type { PracticeProblem } from './practice-presentation'
import type { ReactElement } from 'react'

export function ProblemNotice({ problem, busy, onRetry }: {
  problem: PracticeProblem
  busy: boolean
  onRetry?: () => void
}): ReactElement {
  return <Notice title={problem.title} action={problem.retry && onRetry
    ? <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={busy} onClick={onRetry}>
      {PRACTICE_COPY.tryAgain}</button>
    : undefined}>{problem.body}</Notice>
}
