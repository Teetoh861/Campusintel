'use client'
// app/courses/[slug]/theory/TheoryPractice.tsx — Theory practice, one question at a time: its place in the set
// ("Question 3 of 15"), the question, its exam tip and, where a suggested answer is published, the answer box and its
// reveal; then Previous and Next. Every question stays mounted while another shows, so a draft, a revealed answer and
// its ratings are still there on the way back. No list of the questions is shown.

import { useId, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { TheoryAttempt } from './TheoryAttempt'
import { theoryQuestionHref } from './presentation'
import type { TheoryQuestion } from '@/lib/theory-practice/contract'

/** A published question; `practicable` when it has a suggested answer to reveal. Without one it is read only. */
export type TheoryStep = { question: TheoryQuestion; practicable: boolean }

export function TheoryPractice({ questions, courseSlug, continuityToken }: {
  questions: ReadonlyArray<TheoryStep>; courseSlug: string; continuityToken: string
}) {
  const id = useId()
  // The address names the question on screen (?question=<id>). A study guide's link names its own question, which opens
  // first; any other address opens the first question.
  const requested = useSearchParams()?.get('question') ?? null
  const [current, setCurrent] = useState(() =>
    Math.max(0, questions.findIndex(({ question }) => question.itemId === requested)))
  const position = useRef<HTMLHeadingElement>(null)
  const total = questions.length

  function show(index: number) {
    const step = questions[index]
    if (step === undefined) return
    setCurrent(index)
    // A reload, or signing in again, comes back to this question.
    window.history.replaceState(null, '', theoryQuestionHref(`/courses/${courseSlug}`, step.question.itemId))
    // Once the question shows, its place takes focus: it is read out, and the page starts at its top.
    requestAnimationFrame(() => position.current?.focus())
  }

  return <div className="min-w-0">
    {questions.map(({ question, practicable }, index) => <div key={question.itemId} hidden={index !== current}>
      <section className="student-surface student-stack" aria-labelledby={`${id}-${index}`}>
        <div className="min-w-0">
          <h2 id={`${id}-${index}`} ref={index === current ? position : undefined} tabIndex={-1}
            className="student-practice-position student-anchor focus:outline-none">
            Question {index + 1} <span>of {total}</span>
          </h2>
          <p className="student-practice-prompt">{question.prompt}</p>
        </div>
        {question.examTip && <p className="student-meta whitespace-pre-wrap [overflow-wrap:anywhere]">
          <b>Exam tip:</b> {question.examTip}
        </p>}
        {practicable && <TheoryAttempt key={`${question.publishedRevision}:${continuityToken}`} question={question}
          courseSlug={courseSlug} continuityToken={continuityToken} />}
      </section>
    </div>)}
    {total > 1 && <div className="student-practice-steps">
      <button type="button" className={studentAction(btnGhost, 'bg-student-surface')} disabled={current === 0}
        onClick={() => show(current - 1)}>Previous</button>
      <button type="button" className={studentAction(btnNavy, studentFocusDark)} disabled={current === total - 1}
        onClick={() => show(current + 1)}>Next</button>
    </div>}
  </div>
}
