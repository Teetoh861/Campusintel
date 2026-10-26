// app/courses/[slug]/quiz/ResumeScreen.tsx — An attempt is still running on the server: say how far it got and continue it.
'use client'

import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PRACTICE_COPY, answeredLine, plural, practiceIdentity } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  answered: number
  total: number
  // Whole minutes left on the server's deadline, as the server read its clock for this page.
  minutesLeft: number
  opening: boolean
  error: string | null
  onContinue: () => void
}

/** No readiness checkbox: the student agreed to these conditions when the attempt started. */
export function ResumeScreen(props: Props): ReactElement {
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={identity.lede} context={<p>{identity.context}</p>} />}>
    <div className="max-w-[720px]">
      <Notice tone="info" title={PRACTICE_COPY.resumeTitle} action={<>
        <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={props.opening}
          onClick={props.onContinue}>{PRACTICE_COPY.resumeAction}</button>
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{PRACTICE_COPY.backToCourse}</Link>
      </>}>
        {answeredLine(props.answered, props.total, 0)} · {props.minutesLeft < 1 ? 'less than a minute' : plural(props.minutesLeft, 'minute')} left
      </Notice>
      {props.opening ? <p role="status" className="student-practice-help mt-3">{PRACTICE_COPY.loading}</p> : null}
      {props.error ? <div className="mt-5"><Notice title={props.error}>{PRACTICE_COPY.startFailedBody}</Notice></div> : null}
    </div>
  </StudentPage>
}
