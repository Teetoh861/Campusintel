// app/courses/[slug]/quiz/InstantResult.tsx — The end of an instant-feedback attempt: correct out of answered, then
// practise again or go back. Every answer was already explained as it was picked, so there is no review here.
'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { ProblemNotice } from './ProblemNotice'
import { INSTANT_COPY, instantScoreLine } from './instant-feedback'
import { PRACTICE_COPY, practiceIdentity } from './practice-presentation'
import type { GradedAttempt } from '@/lib/practice/contract'
import type { PracticeProblem } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  attempt: GradedAttempt
  // A new attempt may start now (current access and a live bank).
  canStartNew: boolean
  starting: boolean
  error: PracticeProblem | null
  onPractiseAgain: () => void
  onRetry: () => void
}

export function InstantResult(props: Props): ReactElement {
  const { attempt } = props
  const answered = attempt.questions.filter(question => question.selected !== null).length
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  // Only an attempt left part-way says how far it got; a finished one needs no second line.
  const lede = answered < attempt.questions.length && answered > 0
    ? `You answered ${answered} of ${attempt.questions.length} questions.` : undefined
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <StudentPage band={<PageBand title={instantScoreLine(attempt.result.score, answered)} lede={lede}
    context={<p>{identity.context}</p>} titleRef={heading} />}>
    {props.error ? <div className="mb-6 max-w-[720px]"><ProblemNotice problem={props.error} busy={props.starting}
      onRetry={props.onRetry} /></div> : null}
    {props.starting ? <p role="status" className="student-practice-help mb-6">{PRACTICE_COPY.starting}</p> : null}
    <div className="student-practice-row !mt-0">
      {props.canStartNew ? <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={props.starting}
        onClick={props.onPractiseAgain}>{INSTANT_COPY.practiseAgain}</button> : null}
      <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
        {PRACTICE_COPY.backToCourse}
      </Link>
    </div>
  </StudentPage>
}
