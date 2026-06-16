// ResultsScreen — the debrief. Score hero, weakest-section line, per-section
// breakdown with tick or proportional bars, and a review list that defaults
// to surfacing missed questions. Every visible figure traces back to the
// shared per-question correctness map from QuizClient.
'use client'

import Link from 'next/link'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import type { QuizQuestion } from '@/lib/types'
import type { AnswersMap, ReviewFilter, SectionStat } from './types'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

// Verdict thresholds (percent). Match the comp.
const STRONG_PCT = 70
const PASS_PCT = 50
// Section tag thresholds. ≥80% mastered, <70% revisit, neutral between.
const MASTERED_PCT = 80
const REVISIT_PCT = 70

type Props = {
  courseCode: string
  courseSlug: string
  questions: ReadonlyArray<QuizQuestion>
  answers: AnswersMap
  correctCount: number
  sections: ReadonlyArray<SectionStat>
  tickLimit: number
  reviewFilter: ReviewFilter
  onReviewFilterChange: (f: ReviewFilter) => void
  onRetake: () => void
}

export function ResultsScreen({
  courseCode,
  courseSlug,
  questions,
  answers,
  correctCount,
  sections,
  tickLimit,
  reviewFilter,
  onReviewFilterChange,
  onRetake,
}: Props) {
  const total = questions.length
  const pct = total === 0 ? 0 : Math.round((correctCount / total) * 100)
  const missedCount = total - correctCount
  const verdict =
    pct >= STRONG_PCT
      ? 'Strong · exam ready'
      : pct >= PASS_PCT
      ? 'Pass · close the gaps'
      : 'Below pass · regroup'

  // The weakest section drives the prose hook above the breakdown.
  const weakest = [...sections].sort(
    (a, b) => a.correct / a.total - b.correct / b.total,
  )[0]

  const reviewItems = questions
    .map((q, i) => ({ q, i, ok: answers[i] === q.correctAnswer }))
    .filter((r) => (reviewFilter === 'all' ? true : !r.ok))

  return (
    <>
      <section className="quiz-results">
        <HeroMotif />
        <div className="wrap">
          <div className="qr-kicker">
            <span className="sd" />Assessment Debrief · {courseCode}
          </div>
          <div className="qr-scorewrap">
            <div className="qr-score">
              {correctCount}<span className="of"> / {total}</span>
            </div>
            <div className="qr-meta">
              <div className="qr-pct">{pct}%</div>
              <span className="qr-msep" />
              <div className="qr-verdict">{verdict}</div>
            </div>
          </div>
          {weakest ? (
            <p className="qr-line">
              Your weakest section is {weakest.name}. Start your revision there.
            </p>
          ) : null}
        </div>
      </section>

      <section className="quiz-active">
        <div className="wrap" style={resultsWrapStyle}>
          <div className="qr-sec">
            <div className="dsec-head">
              <span className="sk">
                <span className="n">01 /</span> Section intelligence
              </span>
            </div>
            <div className="breakdown">
              {sections.map((s) => (
                <BreakdownRow key={s.name} stat={s} tickLimit={tickLimit} />
              ))}
            </div>
          </div>

          <div className="qr-review">
            <div className="dsec-head">
              <span className="sk">
                <span className="n">02 /</span> Review
              </span>
            </div>
            <div className="review-filter">
              <button
                type="button"
                className={reviewFilter === 'missed' ? 'active' : ''}
                onClick={() => onReviewFilterChange('missed')}
              >
                Missed ({missedCount})
              </button>
              <button
                type="button"
                className={reviewFilter === 'all' ? 'active' : ''}
                onClick={() => onReviewFilterChange('all')}
              >
                All {total}
              </button>
            </div>

            {reviewItems.length === 0 ? (
              <div className="res-empty">
                <div className="re-label">Nothing missed</div>
                <p>
                  You answered every question correctly in this attempt. Switch
                  to “All” to review the full paper.
                </p>
              </div>
            ) : (
              <div className="rev-list">
                {reviewItems.map(({ q, i, ok }) => (
                  <ReviewCard
                    key={i}
                    q={q}
                    n={i + 1}
                    your={answers[i]}
                    ok={ok}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="qr-cta">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRetake}
            >
              Retake assessment <span className="arrow">&rarr;</span>
            </button>
            <Link className="btn btn-secondary" href={`/courses/${courseSlug}`}>
              Back to course
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

const resultsWrapStyle = {
  maxWidth: 760,
  marginLeft: 'auto',
  marginRight: 'auto',
}

function BreakdownRow({
  stat,
  tickLimit,
}: {
  stat: SectionStat
  tickLimit: number
}) {
  const pct = stat.total === 0 ? 0 : Math.round((stat.correct / stat.total) * 100)
  const mastered = pct >= MASTERED_PCT
  const revisit = pct < REVISIT_PCT
  const missed = stat.total - stat.correct
  const ariaLabel = `${stat.correct} of ${stat.total} correct, ${missed} missed`

  return (
    <div className="bd-row">
      <div className="bd-name">
        SECTION {stat.letter} · {stat.name.toUpperCase()}
        {mastered ? <span className="bd-tag">Mastered</span> : null}
        {!mastered && revisit ? (
          <span className="bd-tag weak">Revisit</span>
        ) : null}
      </div>
      <div className="bd-fig">
        {stat.correct} / {stat.total}
        {missed > 0 ? (
          <span className="bd-miss"> · {missed} missed</span>
        ) : (
          <span className="bd-pct"> · {pct}%</span>
        )}
      </div>
      {stat.total <= tickLimit ? (
        // Discrete ticks — each one is the REAL result at that position in
        // the attempt order. No left-fill of greens followed by reds.
        <div className="bd-bar ticks" role="img" aria-label={ariaLabel}>
          {stat.marks.map((m) => (
            <span
              key={m.qIdx}
              className={`bd-tick${m.ok ? '' : ' miss'}`}
              title={`Q${m.qIdx + 1} · ${m.ok ? 'correct' : 'missed'}`}
            />
          ))}
        </div>
      ) : (
        <div className="bd-bar" role="img" aria-label={ariaLabel}>
          <span className="bd-fill hit" style={{ width: `${pct}%` }} />
          <span className="bd-fill miss" style={{ width: `${100 - pct}%` }} />
        </div>
      )}
    </div>
  )
}

function ReviewCard({
  q,
  n,
  your,
  ok,
}: {
  q: QuizQuestion
  n: number
  your: number | undefined
  ok: boolean
}) {
  const statusClass = ok ? 'rev-status correct' : 'rev-status wrong'
  const statusIc = ok ? '✓' : '✗'
  const statusLabel = ok ? 'Correct' : 'Missed'

  return (
    <div className="rev">
      <div className="rev-head">
        <span className="rev-n">Q{n}</span>
        <span className="rev-sec">Section {q.section}</span>
        <span className={statusClass}>
          <span className="ic">{statusIc}</span>
          {statusLabel}
        </span>
      </div>
      <div className="rev-stem">{q.question}</div>
      <div className="rev-opts">
        {q.options.map((text, oi) => {
          const isCorrect = oi === q.correctAnswer
          const isYour = oi === your && !isCorrect
          const cls = `rev-opt${isCorrect ? ' correct' : isYour ? ' yourwrong' : ''}`
          const tag = isCorrect ? (
            <span className="ro-tag">
              <span className="ic">✓</span> Correct
            </span>
          ) : isYour ? (
            <span className="ro-tag">
              <span className="ic">✗</span> Your answer
            </span>
          ) : null
          return (
            <div key={oi} className={cls}>
              <span className="ro-l">{OPTION_LETTERS[oi]}</span>
              <span className="ro-t">{text}</span>
              {tag}
            </div>
          )
        })}
      </div>
    </div>
  )
}
