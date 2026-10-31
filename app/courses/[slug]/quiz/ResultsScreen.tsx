// app/courses/[slug]/quiz/ResultsScreen.tsx — This attempt's score as the server graded it, its feedback band and the
// next actions the student may take now.
'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Check, Minus, X } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { wholeBankAttempt } from '@/lib/practice/contract'
import { ProblemNotice } from './ProblemNotice'
import { PRACTICE_COPY, minutesOf, plural, practiceBand, practiceIdentity } from './practice-presentation'
import type { GradedExam } from '@/lib/practice/contract'
import type { PracticeProblem } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  attempt: GradedExam
  // A new attempt may start now (current access and a live bank): only then are next attempts offered.
  canStartNew: boolean
  // This tab still held answers the server never received when time ran out.
  unsentAtDeadline: boolean
  starting: boolean
  error: PracticeProblem | null
  onRetry: () => void
  onReview: () => void
  onRetake: () => void
  onRedo: () => void
}

const SECONDS_PER_MINUTE = 60

/** Whole minutes between the server's start and finish, rounded up and never more than the attempt's duration. */
export function minutesUsedOf(attempt: GradedExam): number {
  const used = Math.max(0, (Date.parse(attempt.result.finishedAt) - Date.parse(attempt.startedAt)) / 1000)
  return Math.min(minutesOf(attempt.durationSeconds), Math.ceil(used / SECONDS_PER_MINUTE))
}

/** Score this attempt only; no cross-attempt history, mastery or section judgement. */
export function ResultsScreen(props: Props): ReactElement {
  const { attempt, canStartNew, starting, error } = props
  const { score: correct, total, timedOut } = attempt.result
  const unanswered = attempt.questions.filter(question => question.selected === null).length
  const incorrect = total - correct - unanswered
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100)
  const toReview = incorrect + unanswered
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  const timeLine = `${minutesUsedOf(attempt)} of ${minutesOf(attempt.durationSeconds)} minutes used`
  const lede = timedOut ? `Submitted automatically when time ran out · ${timeLine}` : `Submitted · ${timeLine}`
  const wholeBank = wholeBankAttempt(attempt)
  // Results is entered by transition or by URL; the screen hands focus to its heading exactly once when it mounts.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <StudentPage band={<PageBand title="Practice result" lede={lede} context={<p>{identity.context}</p>} titleRef={heading} />}>
    {timedOut ? <div className="mb-6 max-w-[720px]">
      <Notice tone="info" title={PRACTICE_COPY.timedOutTitle}>
        {PRACTICE_COPY.timedOutBody}{props.unsentAtDeadline ? ` ${PRACTICE_COPY.unsentAtDeadline}` : ''}
      </Notice>
    </div> : null}
    {error ? <div className="mb-6 max-w-[720px]"><ProblemNotice problem={error} busy={starting} onRetry={props.onRetry} /></div> : null}
    {starting ? <p role="status" className="student-practice-help mb-6">{PRACTICE_COPY.starting}</p> : null}
    <div className="student-practice-results">
      <section aria-labelledby="student-practice-score-heading">
        <h2 id="student-practice-score-heading" className="sr-only">Score for this attempt</h2>
        <div className="student-practice-score">
          <span className="student-practice-score-pct">{percent}%</span>
          <span className="student-practice-score-of">{correct} of {total} correct</span>
        </div>
        <p className="student-practice-band"><b>{practiceBand(percent)}</b><span>{PRACTICE_COPY.bandNote}</span></p>
        <dl className="student-practice-break">
          <div><dt><Check aria-hidden="true" size={16} strokeWidth={2.25} />Correct</dt><dd>{correct}</dd></div>
          <div><dt><X aria-hidden="true" size={16} strokeWidth={2.25} />Incorrect</dt><dd>{incorrect}</dd></div>
          <div><dt><Minus aria-hidden="true" size={16} strokeWidth={2.25} />Unanswered</dt><dd>{unanswered}</dd></div>
        </dl>
        <p className="student-practice-meta"><Check aria-hidden="true" size={16} strokeWidth={2.25} />{PRACTICE_COPY.saved}</p>
      </section>

      <section className="student-practice-next" aria-labelledby="student-practice-next-heading">
        <h2 id="student-practice-next-heading">{plural(toReview, 'question')} to review</h2>
        <p>See the correct answer for every question in this attempt.</p>
        <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={props.onReview}>Review answers</button>
        {canStartNew && wholeBank ? <button type="button" className={studentAction(btnGhost)} disabled={starting}
          onClick={props.onRetake}>Practise again</button> : null}
        {canStartNew && !wholeBank ? <>
          <button type="button" className={studentAction(btnGhost)} disabled={starting} onClick={props.onRetake}>Retake with new questions</button>
          <button type="button" className={studentAction(btnGhost, 'border-transparent')} disabled={starting} onClick={props.onRedo}>Redo these questions</button>
        </> : null}
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'border-transparent')}>{PRACTICE_COPY.backToCourse}</Link>
        {canStartNew && !wholeBank ? <p className="student-practice-help !mt-0">Retake gives you a new set of questions. Redo repeats these questions in the same order.</p> : null}
      </section>
    </div>
  </StudentPage>
}
