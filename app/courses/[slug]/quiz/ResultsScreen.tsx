// ResultsScreen — Variant B debrief (warm off-white). VISUAL RESKIN ONLY:
// navy score hero (AA-safe, not amber), section breakdown with per-position
// ticks (green correct / muted-red missed), and a review list defaulting to
// missed. Every figure still traces to the shared per-question map; color is
// never the only signal (glyphs + text labels carry meaning). No logic changed.
'use client'

import Link from 'next/link'
import type { QuizQuestion } from '@/lib/types'
import type { AnswersMap, ReviewFilter, SectionStat } from './types'
import { Arrow, btnAccent, btnBase, btnGhost, cx } from '@/components/chrome/ui'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

// Verdict thresholds (percent). Match the comp.
const STRONG_PCT = 70
const PASS_PCT = 50
// Section tag thresholds. >=80% mastered, <70% revisit, neutral between.
const MASTERED_PCT = 80
const REVISIT_PCT = 70

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

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
    <section className="bg-ci-paper pb-20 pt-12 min-[900px]:pt-16">
      {/* score hero */}
      <div className={WRAP}>
        <div className="inline-flex items-center gap-[9px] text-[12.5px] font-bold uppercase tracking-[0.14em] text-ci-gray-500">
          <span className="h-[7px] w-[7px] rounded-full bg-ci-accent" />
          Assessment Debrief · {courseCode}
        </div>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="text-[clamp(56px,12vw,88px)] font-extrabold leading-none tracking-[-0.03em] text-ci-navy-900 [font-variant-numeric:tabular-nums]">
            {correctCount}
            <span className="text-ci-gray-400"> / {total}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[clamp(20px,4vw,26px)] font-bold text-ci-navy-900 [font-variant-numeric:tabular-nums]">{pct}%</div>
            <span className="h-[18px] w-px bg-ci-border-2" />
            <div className="text-[15px] font-medium text-ci-gray-600">{verdict}</div>
          </div>
        </div>
        {weakest ? (
          <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.55] text-ci-gray-600">
            Your weakest section is {weakest.name}. Start your revision there.
          </p>
        ) : null}
      </div>

      <div className={cx(WRAP, 'mt-12')}>
        <div className="mx-auto max-w-[760px]">
          {/* section breakdown */}
          <div>
            <div className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.14em] text-ci-gray-500">
              <span className="text-ci-accent-600">01 /</span> Section intelligence
            </div>
            <div className="flex flex-col gap-5">
              {sections.map((s) => (
                <BreakdownRow key={s.name} stat={s} tickLimit={tickLimit} />
              ))}
            </div>
          </div>

          {/* review */}
          <div className="mt-12">
            <div className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.14em] text-ci-gray-500">
              <span className="text-ci-accent-600">02 /</span> Review
            </div>
            <div className="mb-5 inline-flex overflow-hidden rounded-[9px] border border-ci-border-2 bg-ci-white">
              <button
                type="button"
                className={cx(
                  'border-r border-ci-border px-[14px] py-[9px] text-[13.5px] font-semibold transition-colors',
                  reviewFilter === 'missed' ? 'bg-ci-navy text-white' : 'text-ci-gray-600 hover:text-ci-navy',
                )}
                onClick={() => onReviewFilterChange('missed')}
              >
                Missed ({missedCount})
              </button>
              <button
                type="button"
                className={cx(
                  'px-[14px] py-[9px] text-[13.5px] font-semibold transition-colors',
                  reviewFilter === 'all' ? 'bg-ci-navy text-white' : 'text-ci-gray-600 hover:text-ci-navy',
                )}
                onClick={() => onReviewFilterChange('all')}
              >
                All {total}
              </button>
            </div>

            {reviewItems.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-ci-border-2 bg-ci-paper-2 p-[40px_24px] text-center">
                <div className="text-[15px] font-bold text-ci-navy-900">Nothing missed</div>
                <p className="mx-auto mt-2 max-w-[42ch] text-[14.5px] text-ci-gray-600">
                  You answered every question correctly in this attempt. Switch to “All” to review the full
                  paper.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {reviewItems.map(({ q, i, ok }) => (
                  <ReviewCard key={i} q={q} n={i + 1} your={answers[i]} ok={ok} />
                ))}
              </div>
            )}
          </div>

          {/* actions */}
          <div className="mt-12 flex flex-wrap gap-[13px]">
            <button type="button" className={cx(btnBase, btnAccent)} onClick={onRetake}>
              Retake assessment <Arrow />
            </button>
            <Link className={cx(btnBase, btnGhost)} href={`/courses/${courseSlug}`}>
              Back to course
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
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
    <div className="rounded-[14px] border border-ci-border bg-ci-white p-[18px_20px] shadow-ci-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-ci-navy">
          Section {stat.letter} · {stat.name.toUpperCase()}
        </span>
        {mastered ? (
          <span className="rounded-full bg-g-50 px-[10px] py-[3px] text-[11px] font-bold uppercase tracking-[0.06em] text-g-700">Mastered</span>
        ) : null}
        {!mastered && revisit ? (
          <span className="rounded-full bg-r-50 px-[10px] py-[3px] text-[11px] font-bold uppercase tracking-[0.06em] text-r-700">Revisit</span>
        ) : null}
        <span className="ml-auto text-[13.5px] font-medium text-ci-gray-600 [font-variant-numeric:tabular-nums]">
          {stat.correct} / {stat.total}
          {missed > 0 ? (
            <span className="text-r-600"> · {missed} missed</span>
          ) : (
            <span className="text-ci-gray-500"> · {pct}%</span>
          )}
        </span>
      </div>

      {stat.total <= tickLimit ? (
        // Discrete ticks — each one is the REAL result at that position in the
        // attempt order. No left-fill of greens followed by reds.
        <div className="mt-3 flex flex-wrap gap-[3px]" role="img" aria-label={ariaLabel}>
          {stat.marks.map((m) => (
            <span
              key={m.qIdx}
              className={cx('h-[10px] w-[10px] rounded-[2px]', m.ok ? 'bg-g-600' : 'bg-r-300')}
              title={`Q${m.qIdx + 1} · ${m.ok ? 'correct' : 'missed'}`}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex h-[10px] w-full overflow-hidden rounded-full" role="img" aria-label={ariaLabel}>
          <span className="block h-full bg-g-600" style={{ width: `${pct}%` }} />
          <span className="block h-full bg-r-300" style={{ width: `${100 - pct}%` }} />
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
  const statusIc = ok ? '✓' : '✗'
  const statusLabel = ok ? 'Correct' : 'Missed'

  return (
    <div className="rounded-[16px] border border-ci-border bg-ci-white p-5 shadow-ci-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] font-bold text-ci-navy [font-variant-numeric:tabular-nums]">Q{n}</span>
        <span className="text-[13px] text-ci-gray-500">Section {q.section}</span>
        <span
          className={cx(
            'ml-auto inline-flex items-center gap-[6px] rounded-full px-[10px] py-[4px] text-[12px] font-bold',
            ok ? 'bg-g-50 text-g-700' : 'bg-r-50 text-r-700',
          )}
        >
          <span aria-hidden="true">{statusIc}</span>
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 text-[15.5px] font-semibold leading-[1.4] text-ci-navy-900">{q.question}</div>
      <div className="mt-4 flex flex-col gap-2">
        {q.options.map((text, oi) => {
          const isCorrect = oi === q.correctAnswer
          const isYour = oi === your && !isCorrect
          const tag = isCorrect ? (
            <span className="ml-auto inline-flex flex-none items-center gap-[5px] text-[12.5px] font-bold text-g-700">
              <span aria-hidden="true">✓</span> Correct
            </span>
          ) : isYour ? (
            <span className="ml-auto inline-flex flex-none items-center gap-[5px] text-[12.5px] font-bold text-r-700">
              <span aria-hidden="true">✗</span> Your answer
            </span>
          ) : null
          return (
            <div
              key={oi}
              className={cx(
                'flex items-center gap-3 rounded-[10px] border p-3',
                isCorrect
                  ? 'border-g-600 bg-g-50'
                  : isYour
                  ? 'border-r-600 bg-r-50'
                  : 'border-ci-border bg-ci-white',
              )}
            >
              <span
                className={cx(
                  'flex h-7 w-7 flex-none items-center justify-center rounded-[7px] border text-[13px] font-bold',
                  isCorrect ? 'border-g-600 text-g-700' : isYour ? 'border-r-600 text-r-700' : 'border-ci-border-2 text-ci-navy',
                )}
              >
                {OPTION_LETTERS[oi]}
              </span>
              <span className="text-[14.5px] leading-[1.4] text-ci-ink">{text}</span>
              {tag}
            </div>
          )
        })}
      </div>
    </div>
  )
}
