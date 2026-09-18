// components/chrome/Feedback.tsx — Domain-independent, compact action and page feedback.
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type FeedbackTone = 'error' | 'success' | 'warning' | 'info'

/** Present semantic feedback; callers own domain copy and error translation. */
export function Feedback({ message, tone = 'info', reserveSpace = false, compact = false }: {
  message: ReactNode; tone?: FeedbackTone; reserveSpace?: boolean; compact?: boolean
}) {
  const Icon = { error: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info }[tone]
  const feedback = message ? <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true"
    className={'flex gap-2 rounded-ci-btn bg-ci-blue-50 text-sm text-ci-ink ' + (reserveSpace || compact ? 'px-2 py-1 leading-5' : 'p-3 leading-relaxed')}>
    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 break-words">{message}</div>
  </div> : null
  return reserveSpace ? <div className="min-h-12">{feedback}</div> : feedback
}
