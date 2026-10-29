// app/courses/[slug]/quiz/ProblemNotice.tsx — A start or resume problem, with Try again when trying again can help.
import Link from 'next/link'
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
  const action = problem.action
    ? <Link href={problem.action.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      {problem.action.label}</Link>
    : problem.retry && onRetry
      ? <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={busy} onClick={onRetry}>
        {PRACTICE_COPY.tryAgain}</button>
      : undefined
  return <Notice title={problem.title} action={action}>{problem.body}</Notice>
}
