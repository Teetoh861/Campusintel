// components/auth/AuthShell.tsx — Shared CampusIntell auth page composition.
import Link from 'next/link'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { DEFAULT_AUTH_REDIRECT } from '@/lib/auth/constants'
import type { ReactNode } from 'react'

/** Render the common mobile-first form surface without reading a session. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mx-auto w-full max-w-lg px-6 py-12 sm:py-16">
    <div className="rounded-ci-panel border border-ci-border bg-ci-white p-6 shadow-ci-card sm:p-8">
      <h1 className="mb-6 text-3xl font-bold text-ci-navy">{title}</h1>
      <div className="space-y-6">{children}</div>
    </div>
    <Link href={DEFAULT_AUTH_REDIRECT} className={AUTH_LINK + ' mt-4'}>Browse courses</Link>
  </section>
}

/** Disabled rollout renders no operational form. */
export function AuthUnavailable() {
  return <p>Student accounts are not available yet. You can continue browsing CampusIntell.</p>
}
