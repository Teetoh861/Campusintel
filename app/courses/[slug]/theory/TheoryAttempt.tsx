'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { THEORY_ANSWER_MAX_LENGTH } from '@/lib/theory-practice/contract'
import { revealTheoryAnswer } from '@/lib/theory-practice/client'
import { SelfAssessment } from './SelfAssessment'
import { theoryTextarea } from './presentation'
import type { FormEvent } from 'react'
import type { TheoryFeedback, TheoryQuestion, TheorySubmitResult } from '@/lib/theory-practice/contract'

function refusalMessage(status: Exclude<TheorySubmitResult['status'], 'ready'>): string {
  if (status === 'signed-out' || status === 'session-changed') {
    return 'Your session changed. Your answer is still here; copy it before signing in again.'
  }
  if (status === 'incomplete') return 'Complete your student profile before practising. Copy your answer before leaving this page.'
  if (status === 'content-changed' || status === 'not-found') {
    return 'The published question or model answer changed. Your answer is still here; copy it, then refresh the questions.'
  }
  return 'We couldn’t load the published model answer. Your answer is still here. Try submitting again.'
}

/** Keep each question's draft in page memory only and reveal no feedback until submission succeeds. */
export function TheoryAttempt({ question, courseSlug, continuityToken }: {
  question: TheoryQuestion; courseSlug: string; continuityToken: string
}) {
  const id = useId()
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<TheoryFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  const pageToken = useRef(continuityToken).current
  const answerField = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => { pending.current?.abort() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || feedback !== null) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    // The draft stays in this component; only the question identity is sent.
    const result = await revealTheoryAnswer({ courseSlug, itemId: question.itemId,
      publishedRevision: question.publishedRevision }, pageToken, controller.signal)
    if (controller.signal.aborted) return
    pending.current = null
    setBusy(false)
    if (result.status === 'ready') setFeedback(result.feedback)
    else setError(refusalMessage(result.status))
  }

  function retry() {
    setFeedback(null)
    setError(null)
    // The field remounts when feedback leaves. Focus it after that DOM commit.
    requestAnimationFrame(() => answerField.current?.focus())
  }

  return <div className="student-stack mt-4 min-w-0">
    {question.examTip && <p className="student-meta whitespace-pre-wrap [overflow-wrap:anywhere]"><b>Exam tip:</b> {question.examTip}</p>}
    {feedback === null ? <form onSubmit={submit} className="student-stack" aria-busy={busy}>
      <div>
        <label htmlFor={`${id}-answer`} className="mb-2 block font-semibold text-student-text-primary">Your answer</label>
        <textarea id={`${id}-answer`} ref={answerField} className={theoryTextarea} rows={9}
          maxLength={THEORY_ANSWER_MAX_LENGTH} value={answer} disabled={busy}
          aria-describedby={`${id}-help ${id}-count`} onChange={event => setAnswer(event.currentTarget.value)} />
        <p id={`${id}-help`} className="student-meta mt-2">Write as much as you can. You can also submit an empty answer to start self-assessment.</p>
        <p id={`${id}-count`} className="student-meta mt-1">{answer.length} / {THEORY_ANSWER_MAX_LENGTH} characters</p>
      </div>
      {error && <p role="alert" className="student-meta">{error}</p>}
      <div><button type="submit" disabled={busy} className={studentAction(btnNavy, studentFocusDark)}>
        {busy ? 'Loading model answer…' : 'Submit and compare'}
      </button></div>
      {busy && <p role="status" className="student-meta">Loading the published answer for self-assessment.</p>}
    </form> : <SelfAssessment feedback={feedback} answer={answer} courseSlug={courseSlug} onRetry={retry} />}
  </div>
}
