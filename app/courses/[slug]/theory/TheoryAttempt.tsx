'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { THEORY_ANSWER_MAX_LENGTH } from '@/lib/theory-practice/contract'
import { revealTheoryAnswer } from '@/lib/theory-practice/client'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { profileSelectionHref } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { SelfAssessment } from './SelfAssessment'
import { theoryTextarea } from './presentation'
import type { FormEvent } from 'react'
import type { TheoryFeedback, TheoryQuestion, TheorySubmitResult } from '@/lib/theory-practice/contract'

type Refusal = { text: string; action?: { label: string; href: string } }

/** Why the suggested answer can't be shown, with the one way on. The draft lives only on this page, so a way on that
 * leaves it says to copy the answer first. Show answer itself is the retry for anything else. */
function refusalFor(status: Exclude<TheorySubmitResult['status'], 'ready'>, page: string): Refusal {
  if (status === 'signed-out') return { text: 'You’ve been signed out. Copy your answer before you sign in.',
    action: { label: 'Sign in', href: `${AUTH_PATHS.login}?next=${encodeURIComponent(page)}` } }
  if (status === 'session-changed') return { text: 'You signed in on another tab. Copy your answer before you reload.',
    action: { label: 'Reload', href: page } }
  if (status === 'incomplete') return { text: 'Complete your profile to practise. Copy your answer first.',
    action: { label: 'Complete your profile', href: profileSelectionHref(page) } }
  if (status === 'locked') return { text: 'Your access to this course has ended. Your answer is still here.',
    action: { label: STUDENT_DESTINATIONS.access.label, href: STUDENT_DESTINATIONS.access.href } }
  if (status === 'content-changed' || status === 'not-found') {
    return { text: 'This question has changed. Copy your answer before you reload.', action: { label: 'Reload', href: page } }
  }
  return { text: 'We couldn’t load the suggested answer.' }
}

/** Keep each question's draft in page memory only and reveal no feedback until submission succeeds. */
export function TheoryAttempt({ question, courseSlug, continuityToken }: {
  question: TheoryQuestion; courseSlug: string; continuityToken: string
}) {
  const id = useId()
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<TheoryFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Refusal | null>(null)
  const page = `/courses/${courseSlug}/theory`
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
    else setError(refusalFor(result.status, page))
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
          // Editing the answer is something else: the last message goes.
          aria-describedby={`${id}-count`} onChange={event => { setAnswer(event.currentTarget.value); setError(null) }} />
        <p id={`${id}-count`} className="student-meta mt-2">{answer.length} / {THEORY_ANSWER_MAX_LENGTH} characters</p>
      </div>
      {error && <p role="alert" className="student-meta">{error.text}{error.action ? <> <a href={error.action.href}
        className={studentAction(btnGhost, 'border-transparent px-2')}>{error.action.label}</a></> : null}</p>}
      <div><button type="submit" disabled={busy} className={studentAction(btnNavy, studentFocusDark)}>
        {busy ? 'Loading answer…' : 'Show answer'}
      </button></div>
      {/* The button already says it is loading; this says it once more to screen readers only. */}
      <p role="status" className="sr-only">{busy ? 'Loading the suggested answer.' : ''}</p>
    </form> : <SelfAssessment feedback={feedback} answer={answer} courseSlug={courseSlug} onRetry={retry} />}
  </div>
}
