// components/auth/AuthShell.tsx — Shared CampusIntell auth page composition.
import { Feedback } from '@/components/chrome/Feedback'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import type { ReactNode } from 'react'

/** Render the common mobile-first form surface without reading a session. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="app-container student-page student-form-width">
    <div className="student-surface student-surface-raised">
      <h1 className="student-title mb-3">{title}</h1>
      <div className="space-y-2">{children}</div>
    </div>
  </section>
}

/** Disabled rollout renders no operational form. */
export function AuthUnavailable() {
  return <Feedback message={AUTH_MESSAGES.comingSoon} />
}
