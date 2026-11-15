import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { accessCopy } from '@/lib/entitlements/presentation'
import { profileSelectionHref } from '@/lib/profile/paths'
import { wholeBankAttempt } from '@/lib/practice/contract'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { ProblemNotice } from './ProblemNotice'
import { practiceIdentity, PRACTICE_COPY } from './practice-presentation'
import type { GradedAttempt } from '@/lib/practice/contract'
import type { PracticeProblem } from './practice-presentation'

type Props = {
  attempt: GradedAttempt
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  canStartNew: boolean
  starting: boolean
  onRetake: () => void
  // A retake that did not start says why, here, with Try again when trying again can help.
  error?: PracticeProblem | null
  onRetry?: () => void
  /** The copy switch (plans_on_sale). */
  plansOnSale?: boolean
}

/** Scores remain available when the database withholds the answer review. */
export function ScoreOnly(props: Props) {
  const { attempt } = props
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  const reason = attempt.reviewUnavailableReason
  const line = reason === 'needs-selection' ? 'Confirm your courses for this semester to see answers.'
    : reason === 'outside-list' ? 'Answers are available for your courses this semester.'
      : accessCopy(props.plansOnSale ?? false).answersLine
  // Confirm courses comes back to this result after the save.
  const confirmHref = profileSelectionHref(`${props.courseHref}/quiz?attempt=${attempt.id}`)
  return <StudentPage band={<PageBand title="Practice result" context={<p>{identity.context}</p>} />}>
    <div className="max-w-[720px] space-y-5">
      <p className="text-2xl font-bold tabular-nums">{attempt.result.score} of {attempt.result.total} correct</p>
      <p>{line}</p>
      {props.error ? <ProblemNotice problem={props.error} busy={props.starting} onRetry={props.onRetry} /> : null}
      {props.starting ? <p role="status" className="student-practice-help">{PRACTICE_COPY.starting}</p> : null}
      <div className="flex flex-wrap gap-3">
        {reason === 'needs-selection' ? <Link href={confirmHref} prefetch={false}
          className={studentAction(btnNavy, studentFocusDark)}>Confirm courses</Link> : null}
        {/* The access line names a plan: its page is one tap away. */}
        {reason !== 'needs-selection' && reason !== 'outside-list' ? <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
          className={studentAction(btnNavy, studentFocusDark)}>{STUDENT_DESTINATIONS.access.label}</Link> : null}
        {props.canStartNew ? <button type="button" disabled={props.starting} onClick={props.onRetake}
          className={studentAction(btnGhost)}>{wholeBankAttempt(attempt) ? 'Practise again' : 'Retake with new questions'}</button> : null}
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost)}>{PRACTICE_COPY.backToCourse}</Link>
      </div>
    </div>
  </StudentPage>
}
