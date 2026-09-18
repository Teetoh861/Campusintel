// components/auth/AuthFormLayout.tsx — Presentation-only form regions; callers own every action and state.
import { Feedback, type FeedbackTone } from '@/components/chrome/Feedback'
import type { ReactNode } from 'react'

export type AuthFormFeedback = { message: string; tone?: FeedbackTone }

/** Keep supplied secondary actions adjacent without deciding their behavior. */
export function AuthSecondaryActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-0 text-sm">{children}</div>
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
