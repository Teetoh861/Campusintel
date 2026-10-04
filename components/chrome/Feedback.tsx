// components/chrome/Feedback.tsx — Domain-independent, compact action and page feedback.
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type FeedbackTone = 'error' | 'success' | 'warning' | 'info'

const toneClass: Record<FeedbackTone, string> = {
  error: 'border-student-error bg-student-error-surface text-student-error',
  success: 'border-student-success bg-student-success-surface text-student-success',
  warning: 'border-student-warning bg-student-warning-surface text-student-warning',
  info: 'border-student-border-strong bg-student-brand-surface text-student-text',
}

/** Present semantic feedback; callers own domain copy and error translation. */
export function Feedback({ message, tone = 'info', reserveSpace = false, compact = false }: {
  message: ReactNode; tone?: FeedbackTone; reserveSpace?: boolean; compact?: boolean
}) {
  const Icon = { error: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info }[tone]
  const feedback = message ? <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true"
    data-tone={tone}
    className={'flex items-start gap-2 rounded-ci-btn border text-[14px] leading-5 ' + toneClass[tone] +
      (reserveSpace || compact ? ' px-3 py-2' : ' p-3 tablet:p-4')}>
    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 break-words">{message}</div>
  </div> : null
  return reserveSpace ? <div className="min-h-12">{feedback}</div> : feedback
}
