// components/student/CampusBotStatus.tsx — What a student reads when Campus Bot has no explanation or reply to show:
// the notice for a student without Campus Bot, a limit, a busy moment or a problem, each with its one way on.
// Shared by Explain and Ask Campus Bot, so the two never word the same state differently.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { SIGNED_IN_ON_ANOTHER_TAB } from '@/lib/auth/constants'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import { accessCopy, FREE_PASS_COPY } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { CampusBotNoticeKind, CampusBotProblem } from '@/lib/campus-bot/contract'
import type { ReactElement } from 'react'

const primary = studentAction(btnNavy, studentFocusDark)
const { access } = STUDENT_DESTINATIONS

/** A student without Campus Bot: one line and the one place it opens. */
export function CampusBotNotice({ kind }: { kind: CampusBotNoticeKind }): ReactElement {
  return <Notice tone="info" title={CAMPUS_BOT_COPY.notice[kind]} action={<Link href={access.href} prefetch={false}
    className={primary}>{kind === 'free-pass' ? FREE_PASS_COPY.start : access.label}</Link>} />
}

type Props = {
  problem: CampusBotProblem
  feature: 'explain' | 'ask' | 'quiz'
  /** Try again, offered only where trying again can help. */
  onRetry?: () => void
  /** Sign in and come back to this page, and this page again for the current sign-in. */
  signInHref: string
  reloadHref: string
}

/** One state, one notice. A state with nothing to say here (a switched-off feature) renders nothing. */
export function CampusBotStatus({ problem, feature, onRetry, signInHref, reloadHref }: Props): ReactElement | null {
  const retry = onRetry === undefined ? undefined
    : <button type="button" className={studentAction(btnGhost, 'bg-student-surface')} onClick={onRetry}>
      {CAMPUS_BOT_COPY.tryAgain}</button>
  const plan = <Link href={access.href} prefetch={false} className={primary}>{access.label}</Link>
  switch (problem.status) {
    case 'not-entitled':
      return <CampusBotNotice kind={problem.notice} />
    case 'limit': {
      const { limits } = CAMPUS_BOT_COPY
      if (problem.limit === 'pass') {
        return <Notice tone="info" title={feature === 'explain' ? limits.passExplain : feature === 'ask'
          ? limits.passChat : limits.passQuiz} action={plan} />
      }
      if (problem.limit === 'undelivered') {
        return <Notice tone="info" title={limits.undelivered.title}>{limits.undelivered.line}</Notice>
      }
      const limit = limits[problem.limit]
      return <Notice tone="info" title={limit.title}>{limit.line(problem.resetsAt)}</Notice>
    }
    case 'locked': {
      // The course is no longer included: the line a withheld answer review shows, or the locked course's own.
      const copy = accessCopy(problem.plansOnSale)
      return <Notice tone="info" title={feature === 'explain' ? copy.answersLine : copy.lockedTitle} action={plan} />
    }
    case 'busy':
    case 'in-progress':
      return <Notice tone="info" title={CAMPUS_BOT_COPY.busyTitle} action={retry}>{CAMPUS_BOT_COPY.busyLine}</Notice>
    case 'exam-open':
      return <Notice tone="info" title={CAMPUS_BOT_COPY.examOpen} />
    case 'signed-out':
      return <Notice title={CAMPUS_BOT_COPY.signedOut} action={<a href={signInHref} className={primary}>
        {CAMPUS_BOT_COPY.signIn}</a>} />
    case 'session-changed':
      return <Notice title={SIGNED_IN_ON_ANOTHER_TAB} action={<a href={reloadHref} className={primary}>
        {CAMPUS_BOT_COPY.reload}</a>} />
    case 'disabled':
      return null
    default:
      return <Notice title={feature === 'explain' ? CAMPUS_BOT_COPY.explainFailed : feature === 'ask'
        ? CAMPUS_BOT_COPY.askFailed : CAMPUS_BOT_COPY.quiz.failed}
        action={problem.status === 'failed' || problem.status === 'unavailable' ? retry : undefined} />
  }
}
