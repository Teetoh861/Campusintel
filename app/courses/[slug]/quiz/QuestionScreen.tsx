// QuestionScreen — Variant B active state (warm off-white, distraction-free).
// VISUAL RESKIN ONLY: sticky top bar (progress + flag + timer + amber fill),
// the stem, four option rows, a fixed mobile action bar / inline desktop, and
// the question navigator (bottom sheet on mobile, sticky rail >=1024px). Every
// handler, condition and computed display value below is unchanged from before.
'use client'

import type { QuizQuestion } from '@/lib/types'
import type { AnswersMap, MarkedMap } from './types'
import { Arrow, btnAccent, btnBase, btnGhost, btnSm, cx } from '@/components/chrome/ui'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const
const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

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

  return (
    <>
      {/* sticky top bar (sits directly under the 74px nav) */}
      <div className="sticky top-[74px] z-40 border-b border-ci-border bg-ci-paper/[0.92] backdrop-blur-[12px]">
        <div className={WRAP}>
          <div className="flex items-center gap-3 py-3">
            <button
              type="button"
              className="inline-flex items-center gap-[10px] text-[12.5px] font-bold uppercase tracking-[0.1em] text-ci-navy [font-variant-numeric:tabular-nums]"
              aria-label="Open question navigator"
              onClick={onOpenNav}
            >
              <span className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
                <i className="block h-[5px] w-[5px] rounded-[1px] bg-current" />
                <i className="block h-[5px] w-[5px] rounded-[1px] bg-current" />
                <i className="block h-[5px] w-[5px] rounded-[1px] bg-current" />
                <i className="block h-[5px] w-[5px] rounded-[1px] bg-current" />
              </span>
              Question {current + 1} <span className="text-ci-gray-500">/ {total}</span>
            </button>

            <span className="ml-auto" />

            <button
              type="button"
              className={cx(
                'inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[13px] font-semibold transition-colors',
                isMarked
                  ? 'border-ci-accent bg-ci-accent-50 text-ci-accent-600'
                  : 'border-ci-border-2 text-ci-gray-600 hover:border-ci-blue-200 hover:text-ci-navy',
              )}
              aria-pressed={isMarked}
              onClick={onToggleMark}
            >
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" aria-hidden="true">
                <path d="M4 2v12M4 2.6h8l-2 2.6 2 2.6H4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden min-[480px]:inline">{isMarked ? 'Flagged' : 'Flag'}</span>
            </button>

            <span
              className={cx(
                'inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[14px] font-bold leading-none [font-variant-numeric:tabular-nums]',
                isLowTime
                  ? 'animate-pulse bg-r-600 text-white motion-reduce:animate-none'
                  : 'bg-ci-blue-50 text-ci-navy',
              )}
              aria-live="polite"
            >
              <span className="h-[6px] w-[6px] rounded-full bg-current opacity-70" />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] opacity-70">Time</span>
              {formatClock(timeLeft)}
            </span>
          </div>
        </div>
        {/* thin amber progress fill */}
        <div className="h-[3px] w-full bg-ci-blue-50">
          <div className="h-full bg-ci-accent transition-[width] duration-200" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <section className="bg-ci-paper pb-[104px] pt-10 min-[900px]:pb-16">
        <div className={WRAP}>
          <div className="grid grid-cols-1 gap-10 min-[1024px]:grid-cols-[1fr_240px] min-[1024px]:items-start min-[1024px]:gap-12">
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold uppercase tracking-[0.1em] text-ci-gray-500">
                <span className="text-ci-navy">Section {sectionLetter}</span> · {sectionName.toUpperCase()}
              </div>
              <h1 className="mt-3 text-[clamp(20px,3vw,26px)] font-semibold leading-[1.3] tracking-[-0.01em] text-ci-navy-900">
                {question.question}
              </h1>

              <div className="mt-6 flex flex-col gap-3">
                {question.options.map((text, oi) => {
                  const isSel = selected === oi
                  return (
                    <button
                      key={oi}
                      type="button"
                      className={cx(
                        'flex w-full items-center gap-4 rounded-[12px] border p-4 text-left transition-[border-color,background-color] duration-150',
                        isSel
                          ? 'border-ci-navy bg-ci-blue-50'
                          : 'border-ci-border bg-ci-white hover:border-ci-blue-200',
                      )}
                      onClick={() => onSelectOption(oi)}
                      aria-pressed={isSel}
                    >
                      <span
                        className={cx(
                          'flex h-8 w-8 flex-none items-center justify-center rounded-[8px] border text-[14px] font-bold',
                          isSel ? 'border-ci-navy bg-ci-navy text-white' : 'border-ci-border-2 text-ci-navy',
                        )}
                      >
                        {OPTION_LETTERS[oi]}
                      </span>
                      <span className="text-[15.5px] leading-[1.45] text-ci-ink">{text}</span>
                    </button>
                  )
                })}
              </div>

              {/* action bar: fixed bottom on mobile, inline on desktop */}
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ci-border bg-ci-paper/[0.95] py-3 backdrop-blur-[12px] min-[900px]:static min-[900px]:mt-8 min-[900px]:border-0 min-[900px]:bg-transparent min-[900px]:py-0 min-[900px]:backdrop-blur-none">
                <div className={cx(WRAP, 'flex items-center justify-between gap-3 min-[900px]:px-0')}>
                  <button
                    type="button"
                    className={cx(btnBase, btnSm, btnGhost, 'disabled:pointer-events-none disabled:opacity-40')}
                    onClick={onPrev}
                    disabled={current === 0}
                  >
                    Previous
                  </button>
                  {isLast ? (
                    <button type="button" className={cx(btnBase, btnSm, btnAccent)} onClick={onSubmit}>
                      Submit <Arrow />
                    </button>
                  ) : (
                    <button type="button" className={cx(btnBase, btnSm, btnAccent)} onClick={onNext}>
                      Next <Arrow />
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

      {/* mobile sheet backdrop */}
      <div
        className={cx(
          'fixed inset-0 z-40 bg-ci-navy-900/40 transition-opacity duration-200 min-[1024px]:hidden',
          navOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
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
  const leftCount = total - answeredCount
  return (
    <aside
      className={cx(
        // mobile: fixed bottom sheet, slides up when navOpen
        'fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-[20px] border-t border-ci-border bg-ci-white p-5 shadow-ci-soft transition-transform duration-200',
        navOpen ? 'translate-y-0' : 'translate-y-full',
        // desktop: static sticky rail
        'min-[1024px]:sticky min-[1024px]:inset-x-auto min-[1024px]:bottom-auto min-[1024px]:top-[150px] min-[1024px]:z-auto min-[1024px]:max-h-none min-[1024px]:translate-y-0 min-[1024px]:overflow-visible min-[1024px]:rounded-[16px] min-[1024px]:border min-[1024px]:shadow-ci-card',
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-ci-gray-500">Navigator</span>
        <button
          type="button"
          className="text-[13px] font-semibold text-ci-navy min-[1024px]:hidden"
          onClick={onCloseNav}
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-6 gap-2 min-[1024px]:grid-cols-5">
        {Array.from({ length: total }, (_, i) => {
          const answered = answersMap[i] !== undefined
          const isCurrent = i === current
          const isMarkedCell = Boolean(markedMap[i])
          return (
            <button
              key={i}
              type="button"
              className={cx(
                'relative flex h-9 items-center justify-center overflow-hidden rounded-[7px] border text-[13px] font-semibold [font-variant-numeric:tabular-nums] transition-colors',
                answered
                  ? 'border-ci-navy bg-ci-navy text-white'
                  : 'border-ci-border-2 bg-ci-white text-ci-gray-600 hover:border-ci-navy hover:text-ci-navy',
                isCurrent && 'ring-2 ring-ci-accent ring-offset-1 ring-offset-ci-white',
              )}
              aria-label={`Question ${i + 1}`}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => onJump(i)}
            >
              {i + 1}
              {isMarkedCell ? (
                <span
                  aria-hidden="true"
                  className="absolute right-0 top-0 h-0 w-0 border-l-[8px] border-t-[8px] border-l-transparent border-t-ci-accent"
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-ci-gray-600">
        <Legend className="border border-ci-border-2 bg-ci-white">Unanswered</Legend>
        <Legend className="border-ci-navy bg-ci-navy">Answered</Legend>
        <Legend className="border border-ci-border-2 bg-ci-white ring-2 ring-ci-accent">Current</Legend>
        <Legend className="border-ci-accent bg-ci-accent">Flagged</Legend>
      </div>

      <div className="mt-4">
        <button type="button" className={cx(btnBase, btnSm, btnAccent, 'w-full')} onClick={onSubmit}>
          Submit assessment
        </button>
      </div>
      <div className="mt-3 text-center text-[12.5px] text-ci-gray-500 [font-variant-numeric:tabular-nums]">
        {answeredCount} answered · {markedCount} flagged · {leftCount} left
      </div>
    </aside>
  )
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[6px]">
      <span className={cx('h-[12px] w-[12px] rounded-[3px]', className)} />
      {children}
    </span>
  )
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
}
