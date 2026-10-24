// app/courses/[slug]/quiz/ReviewCard.tsx — One reviewed question: static marking, honest unanswered state, optional explanation.
'use client'

import { useRef } from 'react'
import { Check, ChevronDown, Info, X } from 'lucide-react'
import { btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { optionLetter } from './practice-presentation'
import type { ReturnFocus } from './focus-return'
import type { GradedQuestion, ReviewStatus } from './types'
import type { ReactElement } from 'react'

type Props = {
  question: GradedQuestion
  n: number
  status: ReviewStatus
  open: boolean
  reported: boolean
  onToggle: () => void
  // The report trigger first; the disclosure stands in once a sent report replaces that trigger with "Reported".
  // Refs, not nodes: the dialog reads them when it closes, after any re-paging this item survived.
  onReport: (returnFocusTo: ReturnFocus) => void
}

const STATUS = {
  correct: { label: 'Correct', Icon: Check },
  incorrect: { label: 'Incorrect', Icon: X },
  unanswered: { label: 'Unanswered', Icon: Info },
} as const

/** Derive the one review status; an unanswered question is never presented as incorrect. */
export function reviewStatus(question: GradedQuestion): ReviewStatus {
  if (question.selected === null) return 'unanswered'
  return question.selected === question.correctOption ? 'correct' : 'incorrect'
}

/** The heading is the disclosure; the collapsed stem stays readable and truncation is visual only. */
export function ReviewCard({ question, n, status, open, reported, onToggle, onReport }: Props): ReactElement {
  const your = question.selected
  const panelId = `student-practice-review-${n}`
  const { label, Icon } = STATUS[status]
  const disclosure = useRef<HTMLButtonElement>(null)
  const reportTrigger = useRef<HTMLButtonElement>(null)
  return <li data-open={open ? 'true' : undefined}>
    <h3 className="student-practice-review-heading">
      <button ref={disclosure} type="button" className="student-practice-review-toggle student-focus-row" aria-expanded={open}
        aria-controls={panelId} onClick={onToggle}>
        <span className="student-practice-review-top">
          <span className="student-practice-position">Question {n}</span>
          <span className="student-practice-status" data-status={status}><Icon aria-hidden="true" size={18} strokeWidth={2.25} />{label}</span>
        </span>
        {open ? null : <span className="student-practice-stem">{question.prompt}</span>}
        <span className="student-practice-review-action">{open ? 'Hide answer' : 'Review answer'}<ChevronDown aria-hidden="true" size={18} /></span>
      </button>
    </h3>
    {open ? <div className="student-practice-review-body" id={panelId}>
      <p className="student-practice-prompt">{question.prompt}</p>
      <ul className="student-practice-review-options">
        {question.options.map((text, index) => {
          const isAnswer = index === question.correctOption
          const isYours = index === your
          const mark = isAnswer ? 'correct' : isYours ? 'incorrect' : undefined
          const tag = isAnswer && isYours ? 'Your answer · Correct' : isAnswer ? 'Correct answer' : isYours ? 'Your answer' : null
          return <li key={index} className="student-practice-review-option" data-mark={mark}>
            <b aria-hidden="true">{optionLetter(index)}</b>
            <span>{text}</span>
            {tag ? <span className="student-practice-review-tag">
              {isAnswer ? <Check aria-hidden="true" size={16} strokeWidth={2.25} /> : <X aria-hidden="true" size={16} strokeWidth={2.25} />}{tag}
            </span> : null}
          </li>
        })}
      </ul>
      {status === 'unanswered' ? <p className="student-practice-help">You didn’t answer this question.</p> : null}
      {question.explanation ? <div className="student-practice-explanation">
        <p className="student-practice-eyebrow">Explanation</p>
        <p>{question.explanation}</p>
      </div> : null}
      <div className="student-practice-review-foot">
        {reported ? <span className="student-practice-reported"><Check aria-hidden="true" size={16} strokeWidth={2.25} />Reported</span>
          : <button ref={reportTrigger} type="button" className={studentAction(btnGhost, 'border-transparent')} aria-haspopup="dialog"
            onClick={() => onReport([reportTrigger, disclosure])}>Report a question</button>}
      </div>
    </div> : null}
  </li>
}
