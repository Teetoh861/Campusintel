// components/chrome/Feedback.tsx — Domain-independent, compact action and page feedback.
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/** Present semantic feedback; callers own domain copy and error translation. */
export function Feedback({ message, tone = 'info' }: {
  message: ReactNode; tone?: 'error' | 'success' | 'warning' | 'info'
}) {
  const Icon = { error: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info }[tone]
  return <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true"
    className="flex gap-2 rounded-ci-btn bg-ci-blue-50 p-3 text-sm leading-relaxed text-ci-ink">
    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 break-words"><span className="sr-only">{tone}: </span>{message}</div>
  </div>
}
