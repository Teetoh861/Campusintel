// components/student/StatusRail.tsx — Restrained margin mark and explicit status text from the approved Student App reference.
import type { ReactElement, ReactNode } from 'react'

/** Communicate unavailable/future states through text, with a quiet supplemental rail. */
export function StatusRail({ children, status = 'soon' }: {
  children: ReactNode
  status?: 'soon' | 'waitlist' | 'unavailable'
}): ReactElement {
  return <span className="student-status-rail" data-status={status}>{children}</span>
}
