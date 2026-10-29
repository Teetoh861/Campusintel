// app/courses/[slug]/quiz/InstantStarting.tsx — A topic's instant feedback on its way: the topic, Starting…, and only
// when the start fails, why and what to do next.
'use client'

import Link from 'next/link'
import { btnGhost } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { ProblemNotice } from './ProblemNotice'
import { PRACTICE_COPY, practiceIdentity } from './practice-presentation'
import type { PracticeProblem } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  topic: string
  busy: boolean
  error: PracticeProblem | null
  onRetry: () => void
}

export function InstantStarting(props: Props): ReactElement {
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  return <StudentPage band={<PageBand title={props.topic} context={<p>{identity.context}</p>} />}>
    {props.error ? <div className="max-w-[720px]">
      <ProblemNotice problem={props.error} busy={props.busy} onRetry={props.onRetry} />
      <div className="student-practice-row">
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
          {PRACTICE_COPY.backToCourse}
        </Link>
      </div>
    </div> : <p role="status" className="student-practice-help !mt-0">{PRACTICE_COPY.starting}</p>}
  </StudentPage>
}
