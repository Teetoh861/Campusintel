// app/courses/[slug]/quiz/IntroScreen.tsx — Brief the student on this attempt and gate readiness for these exact conditions.
'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Checkbox } from '@/components/ui/checkbox'
import { PRACTICE_COPY, minutesOf, plural, practiceIdentity } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  questionCount: number
  bankSize: number
  timerSeconds: number
  briefingVersion: number
  preparing: boolean
  error: string | null
  onStart: () => void
}

/** Readiness is tied to the briefing version, so changed conditions always ask again. */
export function IntroScreen({ courseCode, courseTitle, courseHref, repositoryOnly, questionCount, bankSize,
  timerSeconds, briefingVersion, preparing, error, onStart }: Props): ReactElement {
  const [readyVersion, setReadyVersion] = useState<number | null>(null)
  const id = useId()
  const ready = readyVersion === briefingVersion
  const minutes = minutesOf(timerSeconds)
  const identity = practiceIdentity(courseCode, courseTitle, repositoryOnly)

  return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={identity.lede} context={<p>{identity.context}</p>} />}>
    <h2 className="student-section-title">This attempt</h2>
    <dl className="student-practice-facts">
      <Fact label="Questions" value={plural(questionCount, 'question')}>
        Selected at random for this attempt from {plural(bankSize, 'published question')}.
      </Fact>
      <Fact label="Time" value={plural(minutes, 'minute')}>
        The timer starts when you press Start practice. It keeps running if you switch tabs or lock your phone.
      </Fact>
      <Fact label="Answering" value="One answer per question">
        Move freely between questions, flag any to revisit, and leave questions unanswered if you choose.
      </Fact>
      <Fact label="Finishing" value="Submit, or time runs out">
        Your score and answer review appear straight after. Leaving before you submit ends the attempt; it can’t be resumed.
      </Fact>
    </dl>

    <label htmlFor={`${id}-ready`} className="student-practice-ack">
      <Checkbox id={`${id}-ready`} checked={ready} disabled={preparing}
        className="student-focus-control h-5 w-5 rounded-[5px] border-student-control-border data-[state=checked]:border-student-primary data-[state=checked]:bg-student-primary data-[state=checked]:text-student-primary-text"
        onCheckedChange={checked => setReadyVersion(checked === true ? briefingVersion : null)} />
      <span>I’m ready to start a {minutes}-minute attempt of {plural(questionCount, 'question')}.</span>
    </label>

    <div className="student-practice-row">
      <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={!ready || preparing}
        aria-describedby={`${id}-help`} onClick={() => { if (ready && !preparing) onStart() }}>Start practice</button>
      <Link href={courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{PRACTICE_COPY.backToCourse}</Link>
    </div>
    <p id={`${id}-help`} className="student-practice-help">
      {ready ? 'The timer starts as soon as you press Start practice.' : 'Confirm you’re ready to start.'}
    </p>
    {preparing ? <p role="status" className="student-practice-help">Checking the latest published questions. The timer has not started.</p> : null}
    {error ? <div className="mt-5"><Notice title={error}>Nothing has started. Review the conditions above before trying again.</Notice></div> : null}
  </StudentPage>
}

function Fact({ label, value, children }: { label: string; value: string; children: string | ReactElement | Array<string | ReactElement> }) {
  return <div><dt>{label}</dt><dd><b>{value}</b>{children}</dd></div>
}
