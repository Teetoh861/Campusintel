'use client'
// app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx — The Discovery Pass CBT exam. The browser holds only the
// questions; the database fixed the deadline when the exam opened, keeps the sheet saved before it, and grades the
// answers once, and only then returns the correct options and explanations. Nothing sent after the deadline is marked.
// The countdown is display only: it starts from the server's own `now` and deadline and runs on the monotonic page
// clock, so the device's time or timezone never changes it. Answers are saved as the student goes through
// lib/entitlements/exam-autosave.ts: in revision order, one request at a time, at once near the deadline, retried
// after a failure, and reported as saved, saving or not saved.
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postDiscoveryCommand } from '@/lib/entitlements/client'
import { MAX_SAVE_REVISION, sampleAnswers } from '@/lib/entitlements/discovery-contract'
import { ExamAutosave } from '@/lib/entitlements/exam-autosave'
import type { SampleAnswers, SampleQuestion, SampleResult, SavedSheet } from '@/lib/entitlements/discovery-contract'
import type { AutosaveSnapshot, SaveOutcome } from '@/lib/entitlements/exam-autosave'
import type { ReactElement } from 'react'

const optionLetter = (index: number) => String.fromCharCode(65 + index)
const TICK_MS = 1000
// When time is up, the marked result is fetched again if the network drops, inside the server's replay window.
const RETRY_MS = 10_000
const MAX_AUTO_RETRIES = 10
const LOW_TIME_MS = 5 * 60_000
// How long a submission waits for the save in flight before sending the same sheet itself.
const FLUSH_WAIT_MS = 3_000

const REFUSAL: Record<string, string> = {
  'expired': 'Your Discovery Pass has ended, so this exam’s result can no longer be shown.',
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'signed-out': 'You’ve been signed out. Sign in again before time runs out.',
}
const RETRY = 'We couldn’t send your answers. They’re still here. Try again.'
const DEADLINE_RULE = 'Only answers saved before time runs out count.'

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

// The sheet kept for this tab, with the revision it reached, so a reload continues from the newest of the browser's
// and the database's copies. Never trusted: re-validated against the pinned questions.
const storedSheet = z.object({ revision: z.number().int().min(0).max(MAX_SAVE_REVISION), answers: sampleAnswers }).strict()

function validAnswers(answers: SampleAnswers, questions: ReadonlyArray<SampleQuestion>): SampleAnswers {
  const options = new Map(questions.map(question => [question.item_id, question.options.length]))
  return Object.fromEntries(Object.entries(answers).filter(([id, index]) => index < (options.get(id) ?? 0)))
}

function readStored(key: string, questions: ReadonlyArray<SampleQuestion>): SavedSheet | null {
  try {
    const parsed = storedSheet.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? 'null'))
    return parsed.success ? { revision: parsed.data.revision, answers: validAnswers(parsed.data.answers, questions) } : null
  } catch { return null }
}

function store(key: string, sheet: SavedSheet): void {
  try { window.sessionStorage.setItem(key, JSON.stringify(sheet)) } catch { /* Storage may be unavailable. */ }
}

/** What the student is told about their sheet right now. */
function saveLine(save: AutosaveSnapshot | null, timeUp: boolean): { text: string; retry: boolean } {
  if (save === null) return { text: 'Answers save automatically as you go.', retry: false }
  if (timeUp || save.state === 'closed') {
    return { text: save.savedRevision >= save.revision ? 'Your answers were saved before time ran out.'
      : 'Your last change may not have been saved before time ran out.', retry: false }
  }
  switch (save.state) {
    case 'saved': return { text: save.savedRevision === 0 ? 'Answers save automatically as you go.' : 'All answers saved.',
      retry: false }
    case 'saving': return { text: 'Saving…', retry: false }
    case 'unsaved': return { text: save.attempts > 0 ? 'Not saved yet. Retrying…' : 'Not saved yet.', retry: false }
    case 'failed': return save.refusal !== null
      ? { text: REFUSAL[save.refusal] ?? 'Your answers can’t be saved any more. Submit to see what was marked.', retry: false }
      : { text: 'Your answers couldn’t be saved. Check your connection.', retry: true }
  }
}

export function DiscoveryExam({ continuityToken, courseSlug, questions, deadlineAt, serverNow, savedSheet, initialResult }: {
  continuityToken: string
  courseSlug: string
  questions: ReadonlyArray<SampleQuestion>
  deadlineAt: string
  serverNow: string
  /** The sheet the database holds for the open exam, and its revision; null once the exam is graded. */
  savedSheet: SavedSheet | null
  initialResult: SampleResult | null
}): ReactElement {
  const storageKey = `discovery-exam:${courseSlug}:${deadlineAt}`
  const initialRemaining = Date.parse(deadlineAt) - Date.parse(serverNow)
  const [answers, setAnswers] = useState<SampleAnswers>(() => validAnswers(savedSheet?.answers ?? {}, questions))
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<SampleResult | null>(initialResult)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [save, setSave] = useState<AutosaveSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const answersRef = useRef(answers)
  const autosave = useRef<ExamAutosave | null>(null)
  // The page clock the moment the server's `now` was shown; every remaining-time reading counts from it.
  const started = useRef<number | null>(null)
  const sending = useRef(false)
  const autoRetries = useRef(0)
  const timeUp = remaining <= 0
  const answered = Object.keys(answers).length

  const remainingMs = useCallback(() => started.current === null ? initialRemaining
    : initialRemaining - (performance.now() - started.current), [initialRemaining])

  useEffect(() => {
    if (result !== null) return
    started.current = performance.now()
    const timer = window.setInterval(() => setRemaining(remainingMs()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [result, remainingMs])

  // One save at a time, numbered, retried and reported. The sheet starts from the newer of the database's copy and
  // the one this tab kept; a newer tab copy is saved at once.
  useEffect(() => {
    if (initialResult !== null) return
    const server: SavedSheet = { revision: savedSheet?.revision ?? 0, answers: validAnswers(savedSheet?.answers ?? {}, questions) }
    const restored = readStored(storageKey, questions)
    const sheet = restored !== null && restored.revision > server.revision ? restored : server
    answersRef.current = sheet.answers
    setAnswers(sheet.answers)
    const send = async (current: SampleAnswers, revision: number): Promise<SaveOutcome> => {
      const outcome = await postDiscoveryCommand({ action: 'save-answers', courseSlug, answers: current, revision },
        continuityToken)
      if (outcome.status === 'saved') return { kind: 'saved', revision: outcome.revision }
      if (outcome.status === 'stale') return { kind: 'stale', revision: outcome.revision, answers: outcome.answers }
      if (outcome.status === 'unavailable') return { kind: 'failed' }
      if (outcome.status === 'ready') {
        // The deadline passed and the database marked the sheet it had: show that result now.
        if (outcome.preview.kind === 'cbt' && outcome.preview.result !== null) setResult(outcome.preview.result)
        return { kind: 'refused', status: 'closed' }
      }
      return { kind: 'refused', status: outcome.status }
    }
    const controller = new ExamAutosave({
      answers: sheet.answers, revision: sheet.revision, savedRevision: server.revision, remaining: remainingMs, send,
      schedule: (run, ms) => window.setTimeout(run, ms), cancel: handle => window.clearTimeout(handle as number),
      onChange: setSave,
      onRebase: merged => { answersRef.current = merged; setAnswers(merged) },
    })
    autosave.current = controller
    // Leaving the page or switching apps sends whatever is unsaved (with keepalive, so it completes).
    const flush = () => { void controller.flush() }
    const hidden = () => { if (document.visibilityState === 'hidden') void controller.flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      controller.stop()
      autosave.current = null
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [initialResult, savedSheet, storageKey, questions, courseSlug, continuityToken, remainingMs])

  const submit = useCallback(async (): Promise<boolean> => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    setMessage(null)
    // Anything unsaved goes first and is given a moment to land; the submission then carries the same sheet, and the
    // server marks whichever reached it in time.
    await Promise.race([autosave.current?.flush() ?? Promise.resolve(),
      new Promise(resolve => window.setTimeout(resolve, FLUSH_WAIT_MS))])
    const outcome = await postDiscoveryCommand({ action: 'submit-exam', courseSlug, answers: answersRef.current },
      continuityToken)
    sending.current = false
    setBusy(false)
    setConfirming(false)
    if (outcome.status === 'ready' && outcome.preview.kind === 'cbt' && outcome.preview.result !== null) {
      autosave.current?.stop()
      setResult(outcome.preview.result)
      try { window.sessionStorage.removeItem(storageKey) } catch { /* Nothing to clear. */ }
      return true
    }
    setMessage(REFUSAL[outcome.status] ?? RETRY)
    return outcome.status !== 'unavailable'
  }, [continuityToken, courseSlug, storageKey])

  // At the deadline any unsaved sheet is sent at once, then the exam submits itself and keeps trying briefly if the
  // network drops. The database marks the sheet it accepted in time, never a later one.
  useEffect(() => {
    if (!timeUp || result !== null) return
    void autosave.current?.flush()
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
    const next = { ...answersRef.current, [itemId]: option }
    answersRef.current = next
    setAnswers(next)
    const revision = autosave.current?.change(next) ?? null
    if (revision !== null) store(storageKey, { revision, answers: next })
  }

  if (result !== null) return <ExamReview questions={questions} result={result} />
  const question = questions[index]!
  const unanswered = questions.length - answered
  const saving = saveLine(save, timeUp)
  return <div className="grid gap-4">
    <div className="student-surface grid gap-1" role="timer" aria-live="off"
      data-urgency={remaining <= LOW_TIME_MS ? 'low' : undefined}>
      <p className="student-detail-kicker">Time left</p>
      <p className={`text-2xl font-bold tabular-nums ${remaining <= LOW_TIME_MS ? 'text-student-error'
        : 'text-student-text-primary'}`}>{timeUp ? 'Time is up' : clock(remaining)}</p>
      <p className="student-meta">{answered} of {questions.length} answered</p>
      <p className="student-meta" role="status" data-save-state={save?.state ?? 'idle'}>
        {saving.text} {DEADLINE_RULE}
      </p>
      {saving.retry && <div><button type="button" onClick={() => autosave.current?.retry()}
        className={studentAction(btnGhost, 'bg-student-surface')}>Save now</button></div>}
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
          {busy ? 'Marking…' : timeUp ? 'See my result' : 'Submit exam'}
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
      {result.timed_out && <p className="student-detail-prose mt-1">Time ran out, so we marked the answers saved before
        the deadline. The correct answers are below.</p>}
      <p className="student-meta mt-1">Regular CBT practice for this course comes with full access.</p>
    </div>
    {questions.map((question, number) => {
      const mark = marks.get(question.item_id)
      const correct = mark !== undefined && mark.selected === mark.correct_option
      return <article key={question.item_id} className="student-surface" data-result={correct ? 'correct' : 'incorrect'}>
        <p className={`student-detail-kicker ${correct ? 'text-student-success' : 'text-student-error'}`}>
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
