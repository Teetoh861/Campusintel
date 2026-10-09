// components/student/Notice.tsx — Student App feedback with explicit recovery and no provider detail.
import { CircleAlert, Info } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

/** Announce meaningful page feedback with its caller-owned, safe recovery action. */
export function Notice({ title, children, action, tone = 'error' }: {
  title: string
  children: ReactNode
  action?: ReactNode
  tone?: 'error' | 'info'
}): ReactElement {
  const Icon = tone === 'error' ? CircleAlert : Info
  return <div className="student-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
    <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
    <div className="student-notice-body">
      <h2 className="student-notice-title">{title}</h2>
      <p className="student-notice-text">{children}</p>
      {action && <div className="student-notice-action">{action}</div>}
    </div>
  </div>
}
