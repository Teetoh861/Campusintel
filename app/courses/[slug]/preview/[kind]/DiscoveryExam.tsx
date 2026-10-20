'use client'
// app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx — The Discovery Pass CBT exam. The browser holds only the
// questions; the database fixed the deadline when the exam opened and grades the answers once, and only then returns
// the correct options and explanations. The countdown is display only: it starts from the server's own `now` and
// deadline and runs on the monotonic page clock, so the device's time or timezone never changes it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postDiscoveryCommand } from '@/lib/entitlements/client'
import { sampleAnswers } from '@/lib/entitlements/discovery-contract'
import type { SampleAnswers, SampleQuestion, SampleResult } from '@/lib/entitlements/discovery-contract'
import type { ReactElement } from 'react'

const optionLetter = (index: number) => String.fromCharCode(65 + index)
const TICK_MS = 1000
// When time is up, a lost submission is retried inside the server's grace window.
const RETRY_MS = 10_000
const MAX_AUTO_RETRIES = 10
const LOW_TIME_MS = 5 * 60_000

const REFUSAL: Record<string, string> = {
  'expired': 'Your Discovery Pass has ended, so this exam can no longer be marked.',
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'signed-out': 'You’ve been signed out. Sign in again before time runs out.',
}
const RETRY = 'We couldn’t send your answers. They’re still here. Try again.'

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

/** Answers kept for this tab only, so a reload or an app switch doesn't lose them. Never trusted: re-validated. */
function readSaved(key: string, questions: ReadonlyArray<SampleQuestion>): SampleAnswers {
  try {
    const parsed = sampleAnswers.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? '{}'))
    if (!parsed.success) return {}
    const options = new Map(questions.map(question => [question.item_id, question.options.length]))
    return Object.fromEntries(Object.entries(parsed.data).filter(([id, index]) => index < (options.get(id) ?? 0)))
  } catch { return {} }
}

function save(key: string, answers: SampleAnswers): void {
  try { window.sessionStorage.setItem(key, JSON.stringify(answers)) } catch { /* Storage may be unavailable. */ }
}

export function DiscoveryExam({ continuityToken, courseSlug, questions, deadlineAt, serverNow, initialResult }: {
  continuityToken: string
  courseSlug: string
  questions: ReadonlyArray<SampleQuestion>
  deadlineAt: string
  serverNow: string
  initialResult: SampleResult | null
}): ReactElement {
  const storageKey = `discovery-exam:${courseSlug}:${deadlineAt}`
  const initialRemaining = Date.parse(deadlineAt) - Date.parse(serverNow)
  const [answers, setAnswers] = useState<SampleAnswers>({})
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<SampleResult | null>(initialResult)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const answersRef = useRef(answers)
  const sending = useRef(false)
  const autoRetries = useRef(0)
  const timeUp = remaining <= 0
  const answered = Object.keys(answers).length

  useEffect(() => { if (initialResult === null) setAnswers(readSaved(storageKey, questions)) },
    [initialResult, storageKey, questions])
  // The submission reads the latest answers even when it is fired by the deadline rather than a click.
  useEffect(() => { answersRef.current = answers }, [answers])

  useEffect(() => {
    if (result !== null) return
    const started = performance.now()
    const timer = window.setInterval(() => setRemaining(initialRemaining - (performance.now() - started)), TICK_MS)
    return () => window.clearInterval(timer)
  }, [result, initialRemaining])

  const submit = useCallback(async (): Promise<boolean> => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    setMessage(null)
    const outcome = await postDiscoveryCommand({ action: 'submit-exam', courseSlug, answers: answersRef.current },
      continuityToken)
    sending.current = false
    setBusy(false)
    setConfirming(false)
    if (outcome.status === 'ready' && outcome.preview.kind === 'cbt' && outcome.preview.result !== null) {
      setResult(outcome.preview.result)
      try { window.sessionStorage.removeItem(storageKey) } catch { /* Nothing to clear. */ }
      return true
    }
    setMessage(REFUSAL[outcome.status] ?? RETRY)
    return outcome.status !== 'unavailable'
  }, [continuityToken, courseSlug, storageKey])

  // At the deadline the exam submits itself, and keeps trying briefly if the network drops.
  useEffect(() => {
    if (!timeUp || result !== null) return
    let cancelled = false
    async function attempt(): Promise<void> {
      if (cancelled || await submit() || autoRetries.current >= MAX_AUTO_RETRIES) return
      autoRetries.current += 1
      window.setTimeout(() => { void attempt() }, RETRY_MS)
    }
    void attempt()
    return () => { cancelled = true }
  }, [timeUp, result, submit])

  function choose(itemId: string, option: number): void {
    if (timeUp) return
    setAnswers(current => {
      const next = { ...current, [itemId]: option }
      save(storageKey, next)
      return next
    })
  }

  if (result !== null) return <ExamReview questions={questions} result={result} />
  const question = questions[index]!
  const unanswered = questions.length - answered
  return <div className="grid gap-4">
    <div className="student-surface grid gap-1" role="timer" aria-live="off"
      data-urgency={remaining <= LOW_TIME_MS ? 'low' : undefined}>
      <p className="student-detail-kicker">Time left</p>
      <p className={`text-2xl font-bold tabular-nums ${remaining <= LOW_TIME_MS ? 'text-student-error-text'
        : 'text-student-text-primary'}`}>{timeUp ? 'Time is up' : clock(remaining)}</p>
      <p className="student-meta">{answered} of {questions.length} answered</p>
    </div>
    <fieldset className="student-surface" key={question.item_id} disabled={timeUp}>
      <legend className="student-detail-kicker">Question {index + 1} of {questions.length}</legend>
      <p className="student-practice-prompt mt-2">{question.prompt}</p>
      <div className="student-practice-options mt-3">
        {question.options.map((text, option) => {
          const checked = answers[question.item_id] === option
          return <label key={option} className="student-practice-option" data-selected={checked ? 'true' : undefined}>
            <input className="sr-only" type="radio" name={question.item_id} value={option} checked={checked}
              onChange={() => choose(question.item_id, option)} />
            <span className="student-practice-option-mark" aria-hidden="true">{optionLetter(option)}</span>
            <span className="student-practice-option-text">{text}</span>
          </label>
        })}
      </div>
    </fieldset>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}
        className={studentAction(btnGhost, 'bg-student-surface')}>Previous</button>
      <button type="button" disabled={index === questions.length - 1} onClick={() => setIndex(index + 1)}
        className={studentAction(btnGhost, 'bg-student-surface')}>Next</button>
    </div>
    <nav aria-label="Questions" className="student-surface">
      <ol className="grid grid-cols-8 gap-1.5 tablet:grid-cols-10">
        {questions.map((item, position) => <li key={item.item_id}>
          <button type="button" onClick={() => setIndex(position)} aria-current={position === index ? 'step' : undefined}
            aria-label={`Question ${position + 1}${answers[item.item_id] === undefined ? ', not answered' : ', answered'}`}
            className={`h-9 w-full rounded-md border text-sm font-semibold tabular-nums student-focus-control ${
              position === index ? 'border-student-primary text-student-primary'
                : answers[item.item_id] !== undefined ? 'border-transparent bg-student-brand-surface text-student-text-primary'
                  : 'border-student-border text-student-text-muted'}`}>{position + 1}</button>
        </li>)}
      </ol>
    </nav>
    <div className="grid gap-2">
      {confirming && !timeUp
        ? <>
          <p className="text-sm text-student-text-primary" role="status">
            {unanswered === 1 ? '1 question is' : `${unanswered} questions are`} not answered. You can only submit once.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={studentAction(btnGhost, 'bg-student-surface')}>
              Keep going</button>
            <button type="button" disabled={busy} onClick={() => void submit()}
              className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Marking…' : 'Submit'}</button>
          </div>
        </>
        : <button type="button" disabled={busy}
          onClick={() => { if (unanswered > 0 && !timeUp) setConfirming(true); else void submit() }}
          className={studentAction(btnNavy, studentFocusDark, 'w-full tablet:w-auto')}>
          {busy ? 'Marking…' : timeUp ? 'Send my answers' : 'Submit exam'}
        </button>}
      {message !== null && <p role="status" className="text-sm text-student-text-secondary">{message}</p>}
    </div>
  </div>
}

function ExamReview({ questions, result }: { questions: ReadonlyArray<SampleQuestion>; result: SampleResult }):
  ReactElement {
  const marks = new Map(result.answers.map(answer => [answer.item_id, answer]))
  return <div className="grid gap-4">
    <div className="student-surface student-surface-raised" role="status">
      <h2 className="student-section-title">You scored {result.score} of {result.total}</h2>
      {result.timed_out && <p className="student-detail-prose mt-1">Time ran out before your answers reached us, so
        this exam was closed without them. The correct answers are below.</p>}
      <p className="student-meta mt-1">Regular CBT practice for this course comes with full access.</p>
    </div>
    {questions.map((question, number) => {
      const mark = marks.get(question.item_id)
      const correct = mark !== undefined && mark.selected === mark.correct_option
      return <article key={question.item_id} className="student-surface" data-result={correct ? 'correct' : 'incorrect'}>
        <p className={`student-detail-kicker ${correct ? 'text-student-success' : 'text-student-error-text'}`}>
          Question {number + 1} · {correct ? 'Correct' : mark?.selected === null ? 'Not answered' : 'Incorrect'}</p>
        <p className="student-practice-prompt mt-2">{question.prompt}</p>
        {mark !== undefined && <>
          {mark.selected !== null && !correct && <p className="student-detail-prose mt-2">
            Your answer: {optionLetter(mark.selected)}. {question.options[mark.selected]}
          </p>}
          <p className="student-detail-prose mt-2 text-student-text-primary">
            Correct answer: {optionLetter(mark.correct_option)}. {question.options[mark.correct_option]}
          </p>
          {mark.explanation !== null && <p className="student-detail-prose mt-2">{mark.explanation}</p>}
        </>}
      </article>
    })}
  </div>
}
