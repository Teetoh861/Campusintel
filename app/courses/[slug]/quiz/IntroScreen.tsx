// app/courses/[slug]/quiz/IntroScreen.tsx — Brief the student on this attempt and gate readiness for these exact conditions.
'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Checkbox } from '@/components/ui/checkbox'
import { ProblemNotice } from './ProblemNotice'
import { PRACTICE_COPY, minutesOf, plural, practiceIdentity } from './practice-presentation'
import type { PracticeProblem } from './practice-presentation'
import type { PracticeBrief } from './types'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  // The server's question count and time for the attempt that would start.
  brief: PracticeBrief
  // The live bank is no larger than the attempt: every question, in a new order (D4).
  wholeBank: boolean
  briefingVersion: number
  starting: boolean
  error: PracticeProblem | null
  lastResultHref: string | null
  onStart: () => void
  onRetry: () => void
}

/** Readiness is tied to the briefing version, so changed conditions always ask again. */
export function IntroScreen({ courseCode, courseTitle, courseHref, repositoryOnly, brief, wholeBank, briefingVersion,
  starting, error, lastResultHref, onStart, onRetry }: Props): ReactElement {
  const [readyVersion, setReadyVersion] = useState<number | null>(null)
  const id = useId()
  const ready = readyVersion === briefingVersion
  const minutes = minutesOf(brief.durationSeconds)
  const identity = practiceIdentity(courseCode, courseTitle, repositoryOnly)

  return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={identity.lede} context={<p>{identity.context}</p>} />}>
    <h2 className="student-section-title">This attempt</h2>
    <dl className="student-practice-facts">
      <Fact label="Questions" value={plural(brief.questionCount, 'question')}>
        {wholeBank ? `All ${plural(brief.questionCount, 'question')} in this course, in a new order each time.`
          : 'Each attempt gives you a new set of questions.'}
      </Fact>
      <Fact label="Time" value={plural(minutes, 'minute')}>
        {PRACTICE_COPY.timerRule}
      </Fact>
      <Fact label="Answering" value="One answer per question">
        Move freely between questions, flag any to revisit, and leave questions unanswered if you choose.
      </Fact>
      <Fact label="Finishing" value="Submit, or time runs out">
        Your answers save as you go. If you leave, come back before time runs out to continue. When time runs out, your saved answers are submitted for you.
      </Fact>
    </dl>

    <label htmlFor={`${id}-ready`} className="student-practice-ack">
      <Checkbox id={`${id}-ready`} checked={ready} disabled={starting}
        className="student-focus-control h-5 w-5 rounded-[5px] border-student-control-border data-[state=checked]:border-student-primary data-[state=checked]:bg-student-primary data-[state=checked]:text-student-primary-text"
        onCheckedChange={checked => setReadyVersion(checked === true ? briefingVersion : null)} />
      <span>I’m ready to start a {minutes}-minute attempt of {plural(brief.questionCount, 'question')}.</span>
    </label>

    <div className="student-practice-row">
      <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={!ready || starting}
        aria-describedby={`${id}-help`} onClick={() => { if (ready && !starting) onStart() }}>Start practice</button>
      <Link href={courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Back</Link>
    </div>
    <p id={`${id}-help`} className="student-practice-help">
      {ready ? 'The timer starts as soon as you press Start practice.' : 'Confirm you’re ready to start.'}
    </p>
    {starting ? <p role="status" className="student-practice-help">{PRACTICE_COPY.starting}</p> : null}
    {error ? <div className="mt-5"><ProblemNotice problem={error} busy={starting} onRetry={onRetry} /></div> : null}
    {lastResultHref ? <p className="student-practice-help mt-5">
      <Link href={lastResultHref} prefetch={false} className="underline">{PRACTICE_COPY.lastResult}</Link>
    </p> : null}
  </StudentPage>
}

function Fact({ label, value, children }: { label: string; value: string; children: string | ReactElement | Array<string | ReactElement> }) {
  return <div><dt>{label}</dt><dd><b>{value}</b>{children}</dd></div>
}
