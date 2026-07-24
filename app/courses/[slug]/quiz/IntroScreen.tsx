// IntroScreen — Variant B "continuous blue" briefing cover before the
// assessment runs. VISUAL RESKIN ONLY: same props, same parameter readout from
// the real quiz; the single primary "Start assessment" still calls onStart.
'use client'

import Link from 'next/link'
import { btnAccent, btnBase, btnGhostOnBlue, cx } from '@/components/chrome/ui'

type Props = {
  courseCode: string
  courseTitle: string
  courseSlug: string
  questionCount: number
  timerSeconds: number
  sectionCount: number
  onStart: () => void
}

const PASS_MARK_PCT = 50
const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

export function IntroScreen({
  courseCode,
  courseTitle,
  courseSlug,
  questionCount,
  timerSeconds,
  sectionCount,
  onStart,
}: Props) {
  const minutes = Math.round(timerSeconds / 60)
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ci-navy),var(--ci-navy-900))] text-white">
      <svg
        className="absolute right-[-60px] top-[-50px] z-0 h-[300px] w-[300px] text-ci-blue-600 opacity-50"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
      </svg>
      <div className={`${WRAP} relative z-[1] pb-16 pt-[30px] min-[900px]:pb-24 min-[900px]:pt-10`}>
        <nav className="mb-[26px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200" aria-label="Breadcrumb">
          <Link href="/courses" className="transition-colors hover:text-white">Courses</Link>
          <span className="text-white/35">/</span>
          <Link href={`/courses/${courseSlug}`} className="transition-colors hover:text-white">{courseCode}</Link>
          <span className="text-white/35">/</span>
          <span className="text-white">Quiz</span>
        </nav>

        <div className="inline-flex items-center gap-[9px] text-[12.5px] font-bold uppercase tracking-[0.14em] text-ci-blue-150">
          <span className="h-[7px] w-[7px] rounded-full bg-ci-accent" />
          Field Assessment · Timed
        </div>
        <div className="mt-4 text-[13px] font-bold uppercase tracking-[0.14em] text-ci-accent">{courseCode}</div>
        <h1 className="mt-2 text-balance text-[clamp(38px,7vw,64px)] font-extrabold leading-none tracking-[-0.035em] text-white">
          {courseTitle}
        </h1>
        <p className="mt-5 max-w-[54ch] text-[clamp(17px,2.2vw,20px)] leading-[1.5] text-ci-blue-150">
          The course, put to the test. {questionCount} questions across{' '}
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}, under
          real time pressure. Your debrief shows exactly where you are strong
          and where to go back.
        </p>

        <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/[0.14] bg-white/[0.14] min-[680px]:grid-cols-4">
          <Param k="Questions" v={String(questionCount)} u="items" />
          <Param k="Time limit" v={String(minutes)} u="min" />
          <Param k="Sections" v={String(sectionCount)} />
          <Param k="Pass mark" v={String(PASS_MARK_PCT)} u="%" />
        </div>

        <div className="mt-8 flex flex-wrap gap-[13px]">
          <button type="button" className={cx(btnBase, btnAccent)} onClick={onStart}>
            Start assessment
          </button>
          <Link className={cx(btnBase, btnGhostOnBlue)} href={`/courses/${courseSlug}`}>
            Back to course
          </Link>
        </div>

        <p className="mt-6 max-w-[60ch] text-[14px] leading-[1.55] text-ci-blue-200">
          Once started, the timer runs continuously. You can move between
          questions and flag any for review before you submit.
        </p>
      </div>
    </section>
  )
}

function Param({ k, v, u }: { k: string; v: string; u?: string }) {
  return (
    <div className="bg-white/[0.06] p-[16px_18px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.13em] text-ci-blue-200">{k}</div>
      <div className="mt-2 text-[20px] font-bold text-white [font-variant-numeric:tabular-nums]">
        {v}
        {u ? <span className="ml-1 text-[13px] font-medium text-ci-blue-200">{u}</span> : null}
      </div>
    </div>
  )
}
