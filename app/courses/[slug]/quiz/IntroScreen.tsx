// app/courses/[slug]/quiz/IntroScreen.tsx — Brief the student and gate readiness for these conditions.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { btnAccent, btnBase, btnGhost, cx } from '@/components/chrome/ui'
import { StudyGuideCallout } from './StudyGuideCallout'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseSlug: string
  questionCount: number
  timerSeconds: number
  sectionCount: number
  briefingVersion: number
  preparing: boolean
  error: string | null
  onStart: () => void
}

const PRACTICE_TARGET_PCT = 50
const STUDY_GUIDE_COURSE_CODE = 'BUA202'
const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

/** Brief the student on the actual timed attempt before asking for readiness. */
export function IntroScreen({ courseCode, courseTitle, courseSlug, questionCount,
  timerSeconds, sectionCount, briefingVersion, preparing, error, onStart }: Props): ReactElement {
  const [readyVersion, setReadyVersion] = useState<number | null>(null)
  const ready = readyVersion === briefingVersion
  const minutes = Math.round(timerSeconds / 60)

  return (
    <section className="bg-ci-paper pb-16 pt-6 min-[800px]:pb-20 min-[800px]:pt-9">
      <div className={WRAP}>
        <nav className="mb-5 flex flex-wrap items-center gap-2 text-[13px] font-medium text-ci-gray-600" aria-label="Breadcrumb">
          <Link href="/courses" className="min-h-11 content-center hover:text-ci-navy">Courses</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/courses/${courseSlug}`} className="min-h-11 content-center hover:text-ci-navy">{courseCode}</Link>
          <span aria-hidden="true">/</span>
          <span className="text-ci-navy-900">Assessment briefing</span>
        </nav>

        <div className="grid items-start gap-6 min-[800px]:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)] min-[800px]:gap-8">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.13em] text-ci-accent-600">Timed practice assessment</p>
            <h1 className="mt-2 text-balance text-[clamp(26px,4vw,38px)] font-bold leading-[1.14] tracking-[-0.025em] text-ci-navy-900">
              {courseCode} <span className="font-medium text-ci-gray-600">· {courseTitle}</span>
            </h1>
            <p className="mt-3 max-w-[58ch] text-[15px] leading-[1.55] text-ci-gray-600">
              Review the conditions and choose when to begin. The timer starts when the assessment opens.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-[16px] border border-ci-border bg-ci-white p-3 shadow-ci-card min-[600px]:grid-cols-4 min-[800px]:grid-cols-2">
              <Condition label="Time limit" value={`${minutes} min`} prominent />
              <Condition label="Questions" value={String(questionCount)} />
              <Condition label="Bank sections" value={String(sectionCount)} />
              <Condition label="CampusIntel practice target" value={`${PRACTICE_TARGET_PCT}%`} />
            </dl>
            <p className="mt-2 text-[12px] leading-[1.5] text-ci-gray-600">
              Questions are drawn from a bank with {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}.
              The sampled attempt may include fewer sections. The practice target is not an institutional pass grade.
            </p>
          </div>

          <div className="rounded-[18px] border border-ci-border bg-ci-white p-5 shadow-ci-card min-[800px]:p-6">
            <h2 className="text-[18px] font-bold text-ci-navy-900">Before you start</h2>
            <ul className="mt-3 space-y-2 text-[14px] leading-[1.5] text-ci-gray-600">
              <li>• The timer runs continuously once started, even if you leave this tab.</li>
              <li>• Expiry submits the assessment automatically.</li>
              <li>• Unanswered questions receive no credit.</li>
              <li>• An abandoned local attempt cannot be resumed.</li>
              <li>• You can flag, revisit and change answers before submission.</li>
            </ul>

            <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 rounded-[9px] border border-ci-border-2 bg-ci-paper-2 px-3 py-2 text-[14px] font-semibold text-ci-navy-900 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-student-focus">
              <input type="checkbox" checked={ready} disabled={preparing}
                onChange={event => setReadyVersion(event.target.checked ? briefingVersion : null)}
                className="h-5 w-5 shrink-0 accent-ci-navy" />
              I&apos;m ready to start the timer
            </label>
            <button type="button" className={cx(btnBase, btnAccent, 'mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50')}
              disabled={!ready || preparing} onClick={() => { if (ready && !preparing) onStart() }}>
              {preparing ? 'Preparing assessment…' : 'Start timed assessment'}
            </button>
            {preparing ? <p role="status" className="mt-3 text-[13px] font-medium text-ci-navy">
              Checking the latest published questions. The timer has not started.
            </p> : null}
            {error ? <p role="alert" className="mt-3 text-[13px] font-medium text-r-600">{error}</p> : null}
            <Link className={cx(btnBase, btnGhost, 'mt-3 w-full')} href={`/courses/${courseSlug}`}>
              Back to course
            </Link>
          </div>
        </div>

        {courseCode.toUpperCase() === STUDY_GUIDE_COURSE_CODE ? (
          <div className="mt-6 border-t border-ci-border pt-4"><StudyGuideCallout /></div>
        ) : null}
      </div>
    </section>
  )
}

function Condition({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  return <div className="rounded-[10px] bg-ci-paper-2 p-3">
    <dt className="text-[11px] font-bold uppercase tracking-[0.07em] text-ci-gray-600">{label}</dt>
    <dd className={cx('mt-1 font-bold text-ci-navy-900 [font-variant-numeric:tabular-nums]',
      prominent ? 'text-[30px] leading-none' : 'text-[20px]')}>{value}</dd>
  </div>
}
