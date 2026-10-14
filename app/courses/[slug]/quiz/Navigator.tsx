// app/courses/[slug]/quiz/Navigator.tsx — Question cells with answered, flagged and current state in name and colour.
'use client'

import { Flag } from 'lucide-react'
import type { AnswersMap, MarkedMap } from './types'
import type { ReactElement } from 'react'

type Props = {
  total: number
  current: number
  answersMap: AnswersMap
  markedMap: MarkedMap
  onJump: (index: number) => void
}

/** Every cell names its question and state; aria-current marks the question on screen. */
export function Navigator({ total, current, answersMap, markedMap, onJump }: Props): ReactElement {
  return <ol className="student-practice-nav">
    {Array.from({ length: total }, (_, index) => {
      const answered = answersMap[index] !== undefined
      const flagged = Boolean(markedMap[index])
      const isCurrent = index === current
      const label = `Question ${index + 1}, ${answered ? 'answered' : 'not answered'}${flagged ? ', flagged' : ''}${isCurrent ? ', current' : ''}`
      return <li key={index}>
        <button type="button" className="student-practice-cell student-focus-control" aria-label={label}
          aria-current={isCurrent ? 'step' : undefined} data-answered={answered ? 'true' : undefined}
          onClick={() => onJump(index)}>
          {index + 1}{flagged ? <Flag aria-hidden="true" strokeWidth={2} /> : null}
        </button>
      </li>
    })}
  </ol>
}

/** The visual key for the cells; the cell names already carry the same facts. */
export function NavigatorLegend(): ReactElement {
  return <ul className="student-practice-legend" aria-hidden="true">
    <li><span className="student-practice-mini" />Not answered</li>
    <li><span className="student-practice-mini" data-answered="true" />Answered</li>
    <li><span className="student-practice-mini"><Flag strokeWidth={2} /></span>Flagged</li>
    <li><span className="student-practice-mini" data-current="true" />Current</li>
  </ul>
}
