// QuestionScreen — the focused active state. Sticky top bar (progress +
// flag + timer + thin progress fill), the stem, four A/B/C/D option rows,
// fixed mobile action bar (Previous secondary / Next primary, or Submit on
// the last question), and the question navigator (bottom sheet on mobile,
// sticky rail on desktop — all handled by quiz.css).
'use client'

import type { QuizQuestion } from '@/lib/types'
import type { AnswersMap, MarkedMap } from './types'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

type Props = {
  question: QuizQuestion
  current: number
  total: number
  sectionLetter: string
  sectionName: string
  selected: number | undefined
  isMarked: boolean
  timeLeft: number
  isLowTime: boolean
  navOpen: boolean
  answeredCount: number
  markedCount: number
  answersMap: AnswersMap
  markedMap: MarkedMap
  onSelectOption: (optIdx: number) => void
  onToggleMark: () => void
  onPrev: () => void
  onNext: () => void
  onJump: (idx: number) => void
  onSubmit: () => void
  onOpenNav: () => void
  onCloseNav: () => void
}

export function QuestionScreen(props: Props) {
  const {
    question,
    current,
    total,
    sectionLetter,
    sectionName,
    selected,
    isMarked,
    timeLeft,
    isLowTime,
    navOpen,
    answeredCount,
    markedCount,
    answersMap,
    markedMap,
    onSelectOption,
    onToggleMark,
    onPrev,
    onNext,
    onJump,
    onSubmit,
    onOpenNav,
    onCloseNav,
  } = props

  const isLast = current === total - 1
  const progressPct = Math.round(((current + 1) / total) * 100)
  const timerClass = isLowTime ? 'qb-timer warn' : 'qb-timer'
  const flagClass = isMarked ? 'qb-flag on' : 'qb-flag'

  return (
    <>
      <div className="quiz-bar">
        <div className="wrap">
          <div className="qb-row">
            <button
              type="button"
              className="qb-progress"
              aria-label="Open question navigator"
              onClick={onOpenNav}
            >
              <span className="qb-grid" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              QUESTION {current + 1} <span className="of">/ {total}</span>
            </button>
            <span className="qb-spacer" />
            <button
              type="button"
              className={flagClass}
              aria-pressed={isMarked}
              onClick={onToggleMark}
            >
              <span className="flagmark" />
              <span className="qb-flag-t">{isMarked ? 'Flagged' : 'Flag'}</span>
            </button>
            <span className={timerClass} aria-live="polite">
              <span className="td" />
              <span className="tlabel">TIME</span>
              {formatClock(timeLeft)}
            </span>
          </div>
        </div>
        <div className="qb-track">
          <div className="qb-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <section className="quiz-active">
        <div className="wrap">
          <div className="qa-grid">
            <div className="qa-main">
              <div className="qa-section">
                <span className="qs-n">SECTION {sectionLetter}</span> ·{' '}
                {sectionName.toUpperCase()}
              </div>
              <h1 className="qa-stem">{question.question}</h1>
              <div className="qa-options">
                {question.options.map((text, oi) => {
                  const optClass = selected === oi ? 'opt sel' : 'opt'
                  return (
                    <button
                      key={oi}
                      type="button"
                      className={optClass}
                      onClick={() => onSelectOption(oi)}
                      aria-pressed={selected === oi}
                    >
                      <span className="opt-l">{OPTION_LETTERS[oi]}</span>
                      <span className="opt-t">{text}</span>
                    </button>
                  )
                })}
              </div>
              <div className="qa-actionbar">
                <div className="qa-actionbar-in">
                  <button
                    type="button"
                    className="btn btn-ghost qa-prev"
                    onClick={onPrev}
                    disabled={current === 0}
                  >
                    Previous
                  </button>
                  {isLast ? (
                    <button
                      type="button"
                      className="btn btn-primary qa-next"
                      onClick={onSubmit}
                    >
                      Submit <span className="arrow">&rarr;</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary qa-next"
                      onClick={onNext}
                    >
                      Next <span className="arrow">&rarr;</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Navigator
              total={total}
              current={current}
              answersMap={answersMap}
              markedMap={markedMap}
              answeredCount={answeredCount}
              markedCount={markedCount}
              navOpen={navOpen}
              onJump={onJump}
              onCloseNav={onCloseNav}
              onSubmit={onSubmit}
            />
          </div>
        </div>
      </section>

      <div
        className={`qnav-backdrop${navOpen ? ' open' : ''}`}
        onClick={onCloseNav}
        aria-hidden="true"
      />
    </>
  )
}

type NavigatorProps = {
  total: number
  current: number
  answersMap: AnswersMap
  markedMap: MarkedMap
  answeredCount: number
  markedCount: number
  navOpen: boolean
  onJump: (idx: number) => void
  onCloseNav: () => void
  onSubmit: () => void
}

function Navigator({
  total,
  current,
  answersMap,
  markedMap,
  answeredCount,
  markedCount,
  navOpen,
  onJump,
  onCloseNav,
  onSubmit,
}: NavigatorProps) {
  const sheetClass = navOpen ? 'qnav-sheet open' : 'qnav-sheet'
  const leftCount = total - answeredCount
  return (
    <div className={sheetClass}>
      <div className="qnav">
        <div className="qnav-head">
          <span className="qnav-title">Navigator</span>
          <button
            type="button"
            className="qnav-close"
            onClick={onCloseNav}
          >
            Close
          </button>
        </div>
        <div className="qgrid">
          {Array.from({ length: total }, (_, i) => {
            const classes = ['qcell']
            if (answersMap[i] !== undefined) classes.push('answered')
            if (i === current) classes.push('current')
            if (markedMap[i]) classes.push('marked')
            return (
              <button
                key={i}
                type="button"
                className={classes.join(' ')}
                aria-label={`Question ${i + 1}`}
                onClick={() => onJump(i)}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
        <div className="qnav-legend">
          <span className="lg"><span className="sw" />Unanswered</span>
          <span className="lg"><span className="sw answered" />Answered</span>
          <span className="lg"><span className="sw current" />Current</span>
          <span className="lg"><span className="sw marked" />Flagged</span>
        </div>
        <div className="qnav-submit">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSubmit}
          >
            Submit assessment
          </button>
        </div>
        <div className="qnav-count">
          {answeredCount} answered · {markedCount} flagged · {leftCount} left
        </div>
      </div>
    </div>
  )
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
}
