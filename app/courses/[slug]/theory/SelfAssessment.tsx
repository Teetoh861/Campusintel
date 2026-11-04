'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { track } from '@vercel/analytics'
import { theorySelfAssessmentCompletedEvent } from '@/lib/analytics/product-events'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { countSelfRatings, THEORY_REFLECTION_MAX_LENGTH } from '@/lib/theory-practice/contract'
import { theoryProse, theoryTextarea } from './presentation'
import type { FormEvent } from 'react'
import type { SelfRating, TheoryFeedback } from '@/lib/theory-practice/contract'

/** Compare verbatim published material and let the student supply every assessment decision. */
export function SelfAssessment({ feedback, answer, courseSlug, onRetry }: {
  feedback: TheoryFeedback; answer: string; courseSlug: string; onRetry: () => void
}) {
  const id = useId()
  const [ratings, setRatings] = useState<Record<number, SelfRating>>({})
  const [reflection, setReflection] = useState('')
  const [complete, setComplete] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const tracked = useRef(false)
  const points = feedback.rubric?.points ?? []
  const counts = countSelfRatings(points, ratings)

  useEffect(() => {
    // A student can close this question while its submission is in flight.
    if (heading.current?.closest('details')?.open !== false) heading.current?.focus()
  }, [complete])

  function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (complete || counts.reviewed !== counts.total) return
    setComplete(true)
    if (!tracked.current) {
      tracked.current = true
      try {
        const event = theorySelfAssessmentCompletedEvent(courseSlug, feedback.rubric !== null,
          { covered: counts.covered, partly: counts.partly, notYet: counts['not-yet'] })
        track(event.name, event.properties)
      } catch { /* Analytics must not interrupt the student's assessment. */ }
    }
  }

  return <div className="student-stack min-w-0">
    <h2 ref={heading} tabIndex={-1} className="student-section-title">
      {complete ? 'Review complete' : 'Compare your answer'}
    </h2>
    <div className="grid min-w-0 gap-6 desktop:grid-cols-2">
      <section aria-labelledby={`${id}-yours`} className="min-w-0">
        <h3 id={`${id}-yours`} className="mb-3 font-semibold text-student-primary">Your answer</h3>
        <p className={theoryProse}>{answer || 'You submitted an empty answer.'}</p>
      </section>
      <section aria-labelledby={`${id}-model`} className="min-w-0">
        <h3 id={`${id}-model`} className="mb-3 font-semibold text-student-primary">Suggested answer</h3>
        <p className={theoryProse}>{feedback.modelAnswer.body}</p>
      </section>
    </div>
    {feedback.rubric && <section aria-labelledby={`${id}-rubric`}>
      <h3 id={`${id}-rubric`} className="mb-3 font-semibold text-student-primary">Marking guide</h3>
      <p className={theoryProse}>{feedback.rubric.body}</p>
    </section>}
    <form onSubmit={finish} className="student-stack">
      {feedback.rubric ? <>
        <p className="student-meta">Rate how well your answer covered each point.</p>
        {points.map((point, index) => <fieldset key={index} disabled={complete} className="min-w-0 rounded-ci-btn-sm border border-student-border p-3">
          <legend className="max-w-full px-1 font-medium text-student-text-primary whitespace-pre-wrap [overflow-wrap:anywhere]">{point}</legend>
          <label htmlFor={`${id}-point-${index}`} className="mb-2 block text-sm text-student-text-primary">How did you do?</label>
          <select id={`${id}-point-${index}`} required className="student-filter-select" value={ratings[index] ?? ''}
            onChange={event => {
              const value = event.currentTarget.value
              if (value === 'covered' || value === 'partly' || value === 'not-yet') setRatings(current => ({ ...current, [index]: value }))
            }}>
            <option value="" disabled>Choose one</option>
            <option value="covered">Got it</option>
            <option value="partly">Partly</option>
            <option value="not-yet">Not yet</option>
          </select>
        </fieldset>)}
        <p role="status" className="student-meta">
          {counts.covered} got it · {counts.partly} partly · {counts['not-yet']} not yet · {counts.reviewed} of {counts.total} points rated.
        </p>
      </> : <p className="student-meta">Compare your answer with the suggested answer and note what you would improve.</p>}
      <div>
        <label htmlFor={`${id}-reflection`} className="mb-2 block font-semibold text-student-text-primary">What would you improve? (optional)</label>
        <textarea id={`${id}-reflection`} className={theoryTextarea} rows={4} maxLength={THEORY_REFLECTION_MAX_LENGTH}
          value={reflection} disabled={complete} onChange={event => setReflection(event.currentTarget.value)} />
      </div>
      <div className="flex flex-wrap gap-3">
        {complete ? <>
          <button type="button" onClick={event => {
            // Prevent this click from submitting if React reuses the node for the Finish button.
            event.preventDefault()
            setComplete(false)
          }} className={studentAction(btnGhost)}>Edit ratings</button>
          <button type="button" onClick={onRetry} className={studentAction(btnNavy, studentFocusDark)}>Try this question again</button>
        </> : <button type="submit" className={studentAction(btnNavy, studentFocusDark)}>Finish review</button>}
      </div>
    </form>
  </div>
}
