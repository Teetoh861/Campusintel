// components/auth/AuthFormLayout.tsx — Presentation-only form regions; callers own every action and state.
import { Feedback, type FeedbackTone } from '@/components/chrome/Feedback'
import { cx, focusRingNavy } from '@/components/chrome/ui'
import type { ReactNode } from 'react'

export type AuthFormFeedback = { message: string; tone?: FeedbackTone }

export const authSecondaryNav = cx(
  'inline-flex min-h-11 items-center rounded-ci-btn px-2 font-semibold text-ci-navy transition-colors hover:bg-ci-blue-50',
  focusRingNavy,
)

/** Keep supplied secondary actions adjacent without deciding their behavior. */
export function AuthSecondaryActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">{children}</div>
}

/** Arrange form regions and render one caller-selected feedback outcome. */
export function AuthFormLayout({ fields, feedback, primaryAction, secondaryActions }: {
  fields: ReactNode; feedback: AuthFormFeedback; primaryAction: ReactNode; secondaryActions?: ReactNode
}) {
  return <div className="grid gap-2">
    <div className="space-y-2">{fields}</div>
    <div className="empty:hidden"><Feedback compact {...feedback} /></div>
    <div>{primaryAction}</div>
    {secondaryActions && <AuthSecondaryActions>{secondaryActions}</AuthSecondaryActions>}
  </div>
}
