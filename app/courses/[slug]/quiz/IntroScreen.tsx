// IntroScreen — the briefing page before the assessment runs. Renders the
// dossier cover (motif + code + title) and the parameter readout pulled from
// the real quiz: questions on offer, time limit, section count. One primary
// "Start assessment" hands control back to QuizClient.
'use client'

import Link from 'next/link'
import { HeroMotif } from '@/components/chrome/HeroMotif'

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
    <section className="quiz-intro">
      <HeroMotif />
      <div className="wrap">
        <nav className="crumb" aria-label="Breadcrumb">
          <Link href="/courses">Courses</Link>
          <span className="sep">/</span>
          <Link href={`/courses/${courseSlug}`}>{courseCode}</Link>
          <span className="sep">/</span>
          <span className="cur">Quiz</span>
        </nav>
        <div className="qi-kicker">
          <span className="sd" />Field Assessment · Timed
        </div>
        <div className="qi-code">{courseCode}</div>
        <h1 className="qi-title">{courseTitle}</h1>
        <p className="qi-lead">
          The dossier, put to the test. {questionCount} questions across{' '}
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}, under
          real time pressure. Your debrief shows exactly where you are strong
          and where to go back.
        </p>
        <div className="qi-params">
          <Param k="Questions" v={String(questionCount)} u="items" />
          <Param k="Time limit" v={String(minutes)} u="min" />
          <Param k="Sections" v={String(sectionCount)} />
          <Param k="Pass mark" v={String(PASS_MARK_PCT)} u="%" />
        </div>
        <div className="qi-cta">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStart}
          >
            Start assessment <span className="arrow">&rarr;</span>
          </button>
          <Link className="btn btn-secondary" href={`/courses/${courseSlug}`}>
            Back to course
          </Link>
        </div>
        <p className="qi-note">
          Once started, the timer runs continuously. You can move between
          questions and flag any for review before you submit.
        </p>
      </div>
    </section>
  )
}

function Param({ k, v, u }: { k: string; v: string; u?: string }) {
  return (
    <div className="qp">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {u ? <span className="u">{u}</span> : null}
      </div>
    </div>
  )
}
