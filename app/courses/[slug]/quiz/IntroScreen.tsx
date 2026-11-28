// app/courses/[slug]/quiz/IntroScreen.tsx — Exam mode's start: how many questions, how long, and one button.
'use client'

import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { ProblemNotice } from './ProblemNotice'
import { PRACTICE_COPY, minutesOf, practiceIdentity } from './practice-presentation'
import type { PracticeProblem } from './practice-presentation'
import type { PracticeBrief } from './types'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  // The server's question count and time for the exam that would start.
  brief: PracticeBrief
  bankSize: number
  starting: boolean
  error: PracticeProblem | null
  lastResultHref: string | null
  onStart: () => void
  onRetry: () => void
}

/** The exam's question count, bank size and duration, the timer's one rule, and Start exam. A brief that changed since the
 * page loaded shows its new numbers here, under the notice that says so. */
export function IntroScreen({ courseCode, courseTitle, courseHref, repositoryOnly, brief, bankSize, starting, error, lastResultHref,
  onStart, onRetry }: Props): ReactElement {
  const minutes = minutesOf(brief.durationSeconds)
  const identity = practiceIdentity(courseCode, courseTitle, repositoryOnly, 'exam')

  return <StudentPage band={<PageBand title={PRACTICE_COPY.examMode} context={<p>{identity.context}</p>} />}>
    <p className="border-y border-student-border py-4 font-semibold text-student-primary">
      {bankSize > brief.questionCount ? `${brief.questionCount} questions from a bank of ${bankSize}` : `${bankSize} questions`} · {minutes} min
    </p>
    <p className="student-practice-help">{PRACTICE_COPY.timerRule}</p>

    <div className="student-practice-row">
      <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={starting}
        onClick={() => { if (!starting) onStart() }}>{PRACTICE_COPY.startExam}</button>
      <Link href={courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{PRACTICE_COPY.backToCourse}</Link>
    </div>
    {starting ? <p role="status" className="student-practice-help">{PRACTICE_COPY.starting}</p> : null}
    {error ? <div className="mt-5"><ProblemNotice problem={error} busy={starting} onRetry={onRetry} /></div> : null}
    {lastResultHref ? <p className="student-practice-help mt-5">
      <Link href={lastResultHref} prefetch={false} className="underline">{PRACTICE_COPY.lastResult}</Link>
    </p> : null}
  </StudentPage>
}
