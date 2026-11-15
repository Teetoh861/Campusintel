// components/student/result-state.ts — Shared product copy, recovery intent and redirects for common Student App result states.
import { redirect } from 'next/navigation'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'

/** A result state's words: a title that says it all, and a second line only when it adds something. */
export type ResultCopy = { readonly title: string; readonly body?: string }

/** Exact copy for the result states more than one course surface reports; each comes with its recovery action. */
export const RESULT_COPY = {
  'course-invariant': { title: 'We couldn’t show the course details.' },
  'courses-unavailable': { title: 'We couldn’t load your courses.' },
  'course-unavailable': { title: 'We couldn’t load this course.' },
  'missing-profile': { title: 'We couldn’t find your profile.' },
} as const satisfies Record<string, ResultCopy>

export type ResultStateId = keyof typeof RESULT_COPY

export type RecoveryAction =
  | { kind: 'retry'; href: string; label: 'Try again' }
  | { kind: 'support'; href: string; label: 'Contact support' }

/** Invariant and profile failures route to support; unavailable states retry the same surface. */
export function recoveryAction(state: ResultStateId, retryHref: string): RecoveryAction {
  return state === 'course-invariant' || state === 'missing-profile'
    ? { kind: 'support', href: STUDENT_DESTINATIONS.contact.href, label: 'Contact support' }
    : { kind: 'retry', href: retryHref, label: 'Try again' }
}

/** The two routing outcomes every gated student page shares: lost session and incomplete selection. */
export function redirectForStudentState(status: 'signed-out' | 'incomplete', returnPath: string): never {
  if (status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(getSafeReturnPath(returnPath)))
}
