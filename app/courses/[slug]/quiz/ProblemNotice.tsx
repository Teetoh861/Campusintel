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
  // A full load: signing in, reloading or opening another attempt starts from the server's view.
  const action = problem.action
    ? <a href={problem.action.href} className={studentAction(btnNavy, studentFocusDark)}>{problem.action.label}</a>
    : problem.retry && onRetry
      ? <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={busy} onClick={onRetry}>
        {PRACTICE_COPY.tryAgain}</button>
      : undefined
  return <Notice title={problem.title} action={action}>{problem.body}</Notice>
}
