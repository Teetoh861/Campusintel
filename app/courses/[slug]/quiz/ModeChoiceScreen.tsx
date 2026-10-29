// app/courses/[slug]/quiz/ModeChoiceScreen.tsx — The practice start: two ways to practise, nothing else first.
// Instant feedback starts straight away; Exam mode opens its brief, which the student confirms before the timer starts.
'use client'

import Link from 'next/link'
import { ChevronRight, CircleCheck, Timer } from 'lucide-react'
import { btnGhost } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { ProblemNotice } from './ProblemNotice'
import { INSTANT_COPY } from './instant-feedback'
import { PRACTICE_COPY, practiceIdentity } from './practice-presentation'
import type { PracticeProblem } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  starting: boolean
  error: PracticeProblem | null
  lastResultHref: string | null
  onInstant: () => void
  onExam: () => void
  onRetry: () => void
}

export function ModeChoiceScreen(props: Props): ReactElement {
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={INSTANT_COPY.choose}
    context={<p>{identity.context}</p>} />}>
    <div className="student-practice-modes">
      <Choice icon={<CircleCheck aria-hidden="true" size={22} strokeWidth={2} />} title={INSTANT_COPY.choiceTitle}
        body={INSTANT_COPY.choiceBody} disabled={props.starting} onClick={props.onInstant} />
      <Choice icon={<Timer aria-hidden="true" size={22} strokeWidth={2} />} title={INSTANT_COPY.examTitle}
        body={INSTANT_COPY.examBody} disabled={props.starting} onClick={props.onExam} />
    </div>
    {props.starting ? <p role="status" className="student-practice-help">{PRACTICE_COPY.starting}</p> : null}
    {props.error ? <div className="mt-4"><ProblemNotice problem={props.error} busy={props.starting} onRetry={props.onRetry} /></div> : null}
    <div className="student-practice-row mt-8">
      <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{PRACTICE_COPY.backToCourse}</Link>
      {props.lastResultHref ? <Link href={props.lastResultHref} prefetch={false}
        className={studentAction(btnGhost, 'border-transparent')}>{PRACTICE_COPY.lastResult}</Link> : null}
    </div>
  </StudentPage>
}

function Choice({ icon, title, body, disabled, onClick }: { icon: ReactElement; title: string; body: string
  disabled: boolean; onClick: () => void }): ReactElement {
  return <button type="button" className="student-practice-mode student-focus-control" disabled={disabled} onClick={onClick}>
    <span className="student-practice-mode-icon">{icon}</span>
    <span className="student-practice-mode-text"><b>{title}</b><span>{body}</span></span>
    <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-practice-mode-go" />
  </button>
}
