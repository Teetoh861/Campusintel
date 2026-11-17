'use client'
// app/courses/ai-practice/[courseId]/PersonalPractice.tsx — Answer a personal AI set with immediate, local feedback.
// Scores never leave the browser and never touch official attempts.
import { useId, useState } from 'react'
import { Check, X } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PERSONAL_PRACTICE_DISCLAIMER } from '@/lib/ai-practice/contract'
import type { PersonalSetView } from '@/lib/ai-practice/upload-contract'
import type { ReactElement } from 'react'

const optionLetter = (index: number) => String.fromCharCode(65 + index)

/** The one label a Campus Bot set carries: from the student's own notes, unless the set says otherwise. */
export function PersonalDisclaimer({ label = PERSONAL_PRACTICE_DISCLAIMER }: { label?: string }): ReactElement {
  return <p className="ai-practice-disclaimer">{label}</p>
}

/** The words a set's screen uses for its source. A set from an upload keeps the defaults; a set written from a notes
 *  topic names the topic in its page title and passes its own label (lib/campus-bot/copy.ts quiz). */
export type PracticeCopy = { heading: string; headingHidden?: boolean; label: string; quoteLead: string }
const UPLOAD_COPY: PracticeCopy = { heading: 'Practise from your notes', label: PERSONAL_PRACTICE_DISCLAIMER,
  quoteLead: 'From your notes:' }

/** Count answered and correct questions for the summary line. */
export function personalScore(set: PersonalSetView, answers: Readonly<Record<string, number>>):
  { answered: number; correct: number; total: number } {
  const answered = set.questions.filter(question => answers[question.id] !== undefined)
  return { answered: answered.length, total: set.questions.length,
    correct: answered.filter(question => answers[question.id] === question.correctOption).length }
}

export function PersonalPractice({ set, onClose, copy = UPLOAD_COPY }: { set: PersonalSetView; onClose(): void
  copy?: PracticeCopy }): ReactElement {
  const id = useId()
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [current, setCurrent] = useState(0)
  const question = set.questions[current]!
  const chosen = answers[question.id]
  const answered = chosen !== undefined
  const score = personalScore(set, answers)
  const finished = score.answered === score.total

  return <section className="ai-practice-run" aria-labelledby={`${id}-heading`}>
    <div className="ai-practice-run-head">
      <h2 id={`${id}-heading`} className={copy.headingHidden ? 'sr-only' : 'ai-practice-run-title'}>{copy.heading}</h2>
      <p className="ai-practice-run-meta">Question {current + 1} of {set.questions.length} · {score.correct} correct so far</p>
    </div>
    <PersonalDisclaimer label={copy.label} />
    <p className="ai-practice-section">{question.section}</p>
    <p className="student-practice-prompt" id={`${id}-prompt`}>{question.prompt}</p>
    <fieldset className="student-practice-options" aria-labelledby={`${id}-prompt`}>
      <legend className="sr-only">Choose one answer</legend>
      {question.options.map((text, index) => {
        const isKey = index === question.correctOption
        const state = !answered ? undefined : isKey ? 'correct' : index === chosen ? 'incorrect' : undefined
        return <label key={index} className="student-practice-option" data-selected={chosen === index ? 'true' : undefined}
          data-result={state}>
          <input className="sr-only" type="radio" name={`${id}-${question.id}`} value={index} checked={chosen === index}
            disabled={answered} onChange={() => setAnswers(previous => ({ ...previous, [question.id]: index }))} />
          <span className="student-practice-option-mark" aria-hidden="true">{optionLetter(index)}</span>
          <span className="student-practice-option-text">{text}</span>
          {state === 'correct' && <Check aria-label="Correct answer" size={18} strokeWidth={2.5} className="ai-practice-mark-correct" />}
          {state === 'incorrect' && <X aria-label="Your answer" size={18} strokeWidth={2.5} className="ai-practice-mark-incorrect" />}
        </label>
      })}
    </fieldset>
    {answered && <div className="ai-practice-feedback" role="status">
      <p className="ai-practice-feedback-verdict">{chosen === question.correctOption ? 'Correct.' :
        `Not quite. The answer is ${optionLetter(question.correctOption)}.`}</p>
      <p>{question.explanation}</p>
      <blockquote className="ai-practice-quote"><span>{copy.quoteLead}</span> “{question.sourceQuote}”</blockquote>
    </div>}
    <div className="student-practice-steps">
      <button type="button" className={studentAction(btnGhost)} disabled={current === 0}
        onClick={() => setCurrent(index => index - 1)}>Previous</button>
      {current < set.questions.length - 1
        ? <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={() => setCurrent(index => index + 1)}>
          Next</button>
        : <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={onClose}>Finish</button>}
    </div>
    {finished && <p className="ai-practice-summary" role="status">
      {score.correct} of {score.total} correct
    </p>}
  </section>
}
