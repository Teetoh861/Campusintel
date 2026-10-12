// components/student/StudentLoadingState.tsx — One live region, one announcement, inert placeholder visuals.
import type { ReactElement, ReactNode } from 'react'

/** Announce loading once; the page supplies the message and the hidden skeleton composition. */
export function StudentLoadingState({ message, children }: {
  message: string
  children: ReactNode
}): ReactElement {
  return <div role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{message}</span>
    <div aria-hidden="true">{children}</div>
  </div>
}
