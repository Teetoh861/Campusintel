// components/auth/AuthShell.tsx — Shared CampusIntell auth page composition.
import Link from 'next/link'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { Feedback } from '@/components/chrome/Feedback'
import { AUTH_MESSAGES, DEFAULT_AUTH_REDIRECT } from '@/lib/auth/constants'
import type { ReactNode } from 'react'

/** Render the common mobile-first form surface without reading a session. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mx-auto w-full max-w-md px-4 py-6 sm:py-8">
    <div className="rounded-ci-panel bg-ci-white p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-ci-navy">{title}</h1>
      <div className="space-y-4">{children}</div>
    </div>
    <Link href={DEFAULT_AUTH_REDIRECT} className={AUTH_LINK + ' mt-4'}>Browse courses</Link>
  </section>
}

/** Disabled rollout renders no operational form. */
export function AuthUnavailable() {
  return <Feedback message={AUTH_MESSAGES.comingSoon} />
}
