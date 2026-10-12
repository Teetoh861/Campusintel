// components/student/ResultNotice.tsx — One rendering of the shared result-state copy and its recovery action.
import Link from 'next/link'
import { btnGhost } from '@/components/chrome/ui'
import { Notice } from './Notice'
import { RESULT_COPY, recoveryAction } from './result-state'
import { studentAction } from './ui'
import type { ResultStateId } from './result-state'
import type { ReactElement, ReactNode } from 'react'

/** Compose Notice with the shared copy; `retryHref` is the surface to reload, `extra` adds page actions. */
export function ResultNotice({ state, retryHref, extra }: {
  state: ResultStateId
  retryHref: string
  extra?: ReactNode
}): ReactElement {
  const copy = RESULT_COPY[state]
  const action = recoveryAction(state, retryHref)
  return <Notice title={copy.title} action={<>
    {action.kind === 'retry'
      ? <a href={action.href} className={studentAction(btnGhost, 'bg-student-surface')}>{action.label}</a>
      : <Link href={action.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{action.label}</Link>}
    {extra}
  </>}>{copy.body}</Notice>
}
