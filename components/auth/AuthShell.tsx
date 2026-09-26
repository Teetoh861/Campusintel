// components/auth/AuthShell.tsx — Shared CampusIntell auth page composition.
import { Feedback } from '@/components/chrome/Feedback'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import type { ReactNode } from 'react'

/** Render the common mobile-first form surface without reading a session. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mx-auto w-full max-w-md px-4 py-6 sm:py-8">
    <div className="rounded-ci-panel bg-ci-white p-4 sm:p-6">
      <h1 className="mb-3 text-2xl font-bold text-ci-navy">{title}</h1>
      <div className="space-y-2">{children}</div>
    </div>
  </section>
}

/** Disabled rollout renders no operational form. */
export function AuthUnavailable() {
  return <Feedback message={AUTH_MESSAGES.comingSoon} />
}
