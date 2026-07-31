'use client'

import { useState } from 'react'
import type { QuizQuestion } from '@/lib/types'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cx } from '@/components/chrome/ui'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

type Props = {
  q: QuizQuestion
  n: number
  your: number | undefined
  ok: boolean
}

export function ReviewCard({ q, n, your, ok }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const statusIc = ok ? '✓' : '✗'
  const statusLabel = ok ? 'Correct' : 'Incorrect'

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="overflow-hidden rounded-[16px] border border-ci-border bg-ci-white shadow-ci-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ci-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ci-accent"
        >
          <span className="flex-none text-[13px] font-bold text-ci-navy [font-variant-numeric:tabular-nums]">
            Q{n}
          </span>
          <span
            className={cx(
              'inline-flex flex-none items-center gap-[5px] rounded-full px-2 py-[3px] text-[12px] font-bold',
              ok ? 'bg-g-50 text-g-700' : 'bg-r-50 text-r-700',
            )}
          >
            <span aria-hidden="true">{statusIc}</span>
            {statusLabel}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ci-navy-900">
            {q.question}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={cx('h-5 w-5 flex-none text-ci-navy', isOpen && 'rotate-180')}
          >
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t border-ci-border px-4 pb-5 pt-4 min-[680px]:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        <div className="mt-3 text-[15.5px] font-semibold leading-[1.4] text-ci-navy-900">
          {q.question}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {q.options.map((text, oi) => {
            const isCorrect = oi === q.correctAnswer
            const isYour = oi === your && !isCorrect
            const tag = isCorrect ? (
              <span className="ml-auto inline-flex flex-none items-center gap-[5px] text-[12.5px] font-bold text-g-700">
                <span aria-hidden="true">✓</span>
                {oi === your ? 'Correct answer · Your answer' : 'Correct answer'}
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
                    isCorrect
                      ? 'border-g-600 text-g-700'
                      : isYour
                      ? 'border-r-600 text-r-700'
                      : 'border-ci-border-2 text-ci-navy',
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
        {q.explanation ? (
          <div className="mt-4 rounded-[10px] border border-ci-border-2 bg-ci-paper-2 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ci-gray-500">
              Explanation
            </div>
            <p className="mt-2 text-[14px] leading-[1.55] text-ci-gray-600">
              {q.explanation}
            </p>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
