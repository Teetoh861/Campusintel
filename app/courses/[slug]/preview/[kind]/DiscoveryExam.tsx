'use client'
// app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx — The Discovery Pass CBT exam. The browser holds only the
// questions; the database fixed the deadline when the exam opened, keeps the sheet saved before it, and grades the
// answers once, and only then returns the correct options and explanations. Nothing sent after the deadline is marked.
// Whether a tap may still change an answer is decided by lib/entitlements/exam-clock.ts: a fresh exchange with the
// server on mount (and again whenever the page comes back into view), with the whole round trip charged as elapsed
// and the time since measured on the monotonic clock, so the cutoff here is never later than the real deadline and
// the device's wall clock is never the authority. Until that exchange lands, answers cannot change. The clock is read
// at the moment of the tap, not from the once-a-second countdown, and a refused tap changes nothing on screen.
// Answers are saved as the student goes through lib/entitlements/exam-autosave.ts: only the questions this tab
// changed, over the revision it last received, so another tab's answers are never overwritten; the database answers
// with the sheet that stands and this tab shows it. Submission is sent at once and carries the same pending changes
// (no wait for a save in flight), and the database grades the sheet it holds once they are laid over it; while a
// submission is in flight the answer controls are inert, so the screen cannot drift from what is being graded.
// "Saved" is shown only once the server confirmed this tab's latest change.
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postDiscoveryCommand } from '@/lib/entitlements/client'
import { sampleAnswers } from '@/lib/entitlements/discovery-contract'
import { ExamAutosave } from '@/lib/entitlements/exam-autosave'
import { ExamClock } from '@/lib/entitlements/exam-clock'
import { browserTabOptions, claimExamTabOnce } from '@/lib/entitlements/exam-tab'
import type { SampleAnswers, SampleQuestion, SampleResult, SavedSheet, SheetDelta } from '@/lib/entitlements/discovery-contract'
import type { AutosaveSnapshot, SaveOutcome, UnsentSheet } from '@/lib/entitlements/exam-autosave'
import type { ClockReading, ClockState } from '@/lib/entitlements/exam-clock'
import type { ExamTab } from '@/lib/entitlements/exam-tab'
import type { ReactElement } from 'react'

const optionLetter = (index: number) => String.fromCharCode(65 + index)
const TICK_MS = 1000
// When time is up, the marked result is fetched again if the network drops, inside the server's replay window.
const RETRY_MS = 10_000
const MAX_AUTO_RETRIES = 10
const LOW_TIME_MS = 5 * 60_000

const REFUSAL: Record<string, string> = {
  'expired': 'Your Discovery Pass has ended, so this exam’s result can no longer be shown.',
  // This tab identity cannot save on this exam (the exam already takes changes from as many tabs as it allows).
  // Saving stops in this tab only; every other tab, and everything already saved, is untouched.
  'too-many-tabs': 'You have too many exam tabs open. Continue in one of your existing tabs — nothing you’ve answered there is lost.',
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'signed-out': 'You’ve been signed out. Sign in again before time runs out.',
}
const RETRY = 'We couldn’t send your answers. They’re still here. Try again.'
// A submission that did not go through with time left: what was confirmed stays saved, the rest stays on this device.
const SUBMIT_RETRY_SAVED = 'Your answers are saved. Submission didn’t go through — try again.'
const SUBMIT_RETRY_UNSAVED = 'Your answers are kept on this device. Submission didn’t go through — try again.'
const SUBMITTING = 'Submitting…'
const DEADLINE_RULE = 'Only answers saved before time runs out count.'
const CHECKING_CLOCK = 'Checking the time left…'
const RECONNECTING = 'Reconnecting… Answers can’t be changed until the connection is back.'

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

// What this tab keeps for a reload: its sheet and the questions it changed but has not had confirmed. Only those are
// laid over the database's sheet, so a reload never reverts another tab's answers. Never trusted: re-validated
// against the pinned questions.
const storedSheet = z.object({ answers: sampleAnswers, dirty: z.array(z.string().uuid()).max(100) }).strict()

function validAnswers(answers: SampleAnswers, questions: ReadonlyArray<SampleQuestion>): SampleAnswers {
  const options = new Map(questions.map(question => [question.item_id, question.options.length]))
  return Object.fromEntries(Object.entries(answers).filter(([id, index]) => index < (options.get(id) ?? 0)))
}

function readStored(key: string, questions: ReadonlyArray<SampleQuestion>): UnsentSheet | null {
  try {
    const parsed = storedSheet.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? 'null'))
    if (!parsed.success) return null
    const pinned = new Set(questions.map(question => question.item_id))
    return { answers: validAnswers(parsed.data.answers, questions), dirty: parsed.data.dirty.filter(item => pinned.has(item)) }
  } catch { return null }
}

function store(key: string, sheet: UnsentSheet): void {
  try { window.sessionStorage.setItem(key, JSON.stringify(sheet)) } catch { /* Storage may be unavailable. */ }
}

/** What the student is told about their sheet right now. */
function saveLine(save: AutosaveSnapshot | null, timeUp: boolean): { text: string; retry: boolean } {
  if (save === null) return { text: 'Answers save automatically as you go.', retry: false }
  if (timeUp || save.state === 'closed') {
    return { text: save.revision === 0 ? 'No answers were chosen before time ran out.'
      : save.savedRevision >= save.revision ? 'Your answers were saved before time ran out.'
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
  // Display only until the clock's own exchange lands: the page's reading of the server clock, as it was rendered.
  const initialRemaining = Date.parse(deadlineAt) - Date.parse(serverNow)
  const [answers, setAnswers] = useState<SampleAnswers>(() => validAnswers(savedSheet?.answers ?? {}, questions))
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<SampleResult | null>(initialResult)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [clockState, setClockState] = useState<ClockState>('unsynced')
  const [clockFailures, setClockFailures] = useState(0)
  const [save, setSave] = useState<AutosaveSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const answersRef = useRef(answers)
  const autosave = useRef<ExamAutosave | null>(null)
  const examClock = useRef<ExamClock | null>(null)
  // The page clock when the exam mounted, for the display-only countdown before the first exchange lands.
  const mounted = useRef<number | null>(null)
  const sending = useRef(false)
  const autoRetries = useRef(0)
  const timeUp = remaining <= 0
  // Answers can change only with a trustworthy clock reading, before the cutoff, and while no submission is in
  // flight: once Submit is tapped the sheet on screen is the sheet being graded.
  const canAnswer = clockState === 'synced' && !timeUp && !busy && save?.refusal !== 'too-many-tabs'
  const answered = Object.keys(answers).length

  // The trustworthy reading when there is one; otherwise the display-only estimate from the rendered values.
  const remainingMs = useCallback((): number => {
    const trusted = examClock.current?.remaining() ?? null
    if (trusted !== null) return trusted
    return mounted.current === null ? initialRemaining : initialRemaining - (performance.now() - mounted.current)
  }, [initialRemaining])

  // This tab's identity for the database's sequence ledger: kept across reloads of this tab (so reloads never use up
  // the exam's tab capacity) and never shared with a duplicated tab (lib/entitlements/exam-tab.ts).
  const [identity, setIdentity] = useState<ExamTab | null>(null)
  const tab = identity?.tab ?? null
  useEffect(() => {
    if (initialResult !== null) return
    // Held for the life of the page (claimExamTabOnce), so a remount reuses it and a duplicated tab is still answered.
    let live = true
    void claimExamTabOnce(browserTabOptions(storageKey)).then(next => { if (live) setIdentity(next) })
    return () => { live = false }
  }, [initialResult, storageKey])

  // The clock: a fresh exchange on mount, again whenever the page comes back into view, and retried after a failure.
  useEffect(() => {
    if (initialResult !== null || tab === null) return
    mounted.current = performance.now()
    const sync = async (): Promise<ClockReading | null> => {
      const outcome = await postDiscoveryCommand({ action: 'sync-exam', courseSlug, tab }, continuityToken)
      if (outcome.status === 'saved' || outcome.status === 'stale' || outcome.status === 'too-many-tabs') {
        // The sheet that stands, from every tab, laid under this tab's unconfirmed changes.
        autosave.current?.adopt({ revision: outcome.revision, answers: validAnswers(outcome.answers, questions) })
        return { serverNow: Date.parse(outcome.now), deadline: Date.parse(outcome.deadlineAt) }
      }
      if (outcome.status === 'ready') {
        if (outcome.preview.kind === 'cbt' && outcome.preview.result !== null) setResult(outcome.preview.result)
        return null
      }
      if (outcome.status !== 'unavailable') setMessage(REFUSAL[outcome.status] ?? RETRY)
      return null
    }
    const controller = new ExamClock({
      monotonic: () => performance.now(), wall: () => Date.now(), sync,
      schedule: (run, ms) => window.setTimeout(run, ms), cancel: handle => window.clearTimeout(handle as number),
      onChange: state => {
        setClockState(state)
        setClockFailures(failures => state === 'synced' ? 0 : failures + 1)
        setRemaining(remainingMs())
      },
    })
    examClock.current = controller
    controller.start()
    const timer = window.setInterval(() => setRemaining(remainingMs()), TICK_MS)
    // Back into view after being hidden: the device may have slept, so the reading is read again before any tap.
    const visible = () => { if (document.visibilityState === 'visible') controller.invalidate() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.stop()
      examClock.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [initialResult, courseSlug, tab, continuityToken, questions, remainingMs])

  // Saves: numbered, only the questions this tab changed, retried and reported. The sheet starts from the database's
  // copy with any changes this tab kept before a reload laid over it; those are saved at once.
  useEffect(() => {
    if (initialResult !== null || identity === null) return
    const server = { revision: savedSheet?.revision ?? 0, answers: validAnswers(savedSheet?.answers ?? {}, questions) }
    const send = async (delta: SheetDelta): Promise<SaveOutcome> => {
      const outcome = await postDiscoveryCommand({ action: 'save-answers', courseSlug, ...delta }, continuityToken)
      if (outcome.status === 'saved' || outcome.status === 'stale') {
        return { kind: outcome.status, revision: outcome.revision, answers: validAnswers(outcome.answers, questions) }
      }
      if (outcome.status === 'too-many-tabs') {
        // The database will take no changes from this tab, now or later. The controller drops its unsent choices and
        // adopts the sheet that stands in one step (the screen follows through onRebase, so nothing refused can look
        // chosen, come back at a sync, or go with the submission), and saving stops in this tab only.
        return { kind: 'refused', status: outcome.status,
          sheet: { revision: outcome.revision, answers: validAnswers(outcome.answers, questions) } }
      }
      if (outcome.status === 'unavailable') return { kind: 'failed' }
      if (outcome.status === 'ready') {
        // The deadline passed and the database marked the sheet it had: show that result now.
        if (outcome.preview.kind === 'cbt' && outcome.preview.result !== null) setResult(outcome.preview.result)
        return { kind: 'refused', status: 'closed' }
      }
      return { kind: 'refused', status: outcome.status }
    }
    // Every report also refreshes what this tab keeps for a reload, so a confirmed change is no longer "unsent" there.
    let controller: ExamAutosave | null = null
    controller = new ExamAutosave({
      tab: identity.tab, startSequence: identity.sequence, onSequence: sequence => identity.remember(sequence),
      server, restored: readStored(storageKey, questions),
      remaining: () => examClock.current?.remaining() ?? null, send,
      schedule: (run, ms) => window.setTimeout(run, ms), cancel: handle => window.clearTimeout(handle as number),
      onChange: snapshot => {
        setSave(snapshot)
        if (controller !== null) store(storageKey, controller.unsent())
      },
      onRebase: merged => { answersRef.current = merged; setAnswers(merged) },
    })
    autosave.current = controller
    const sheet = controller.unsent().answers
    answersRef.current = sheet
    setAnswers(sheet)
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
  }, [initialResult, savedSheet, storageKey, questions, courseSlug, continuityToken, identity])

  const submit = useCallback(async (): Promise<boolean> => {
    if (sending.current || tab === null) return false
    sending.current = true
    setBusy(true)
    setMessage(null)
    // Sent at once, carrying this tab's pending changes under the same contract as a save: nothing waits for a save
    // in flight. The database lays the changes still in time over the sheet it holds, under its lock, and grades that.
    const delta: SheetDelta = autosave.current?.delta() ?? { tab, sequence: 0, baseRevision: 0, changes: {} }
    const outcome = await postDiscoveryCommand({ action: 'submit-exam', courseSlug, ...delta }, continuityToken)
    if (outcome.status === 'ready' && outcome.preview.kind === 'cbt' && outcome.preview.result !== null) {
      // Accepted: no save answer arriving from now on may touch the sheet on screen.
      autosave.current?.stop()
      sending.current = false
      setBusy(false)
      setConfirming(false)
      setResult(outcome.preview.result)
      try { window.sessionStorage.removeItem(storageKey) } catch { /* Nothing to clear. */ }
      return true
    }
    sending.current = false
    setBusy(false)
    setConfirming(false)
    if (outcome.status === 'unavailable') {
      setMessage(autosave.current?.snapshot().state === 'saved' ? SUBMIT_RETRY_SAVED : SUBMIT_RETRY_UNSAVED)
      return false
    }
    setMessage(REFUSAL[outcome.status] ?? RETRY)
    return true
  }, [continuityToken, courseSlug, storageKey, tab])

  // At the deadline the exam submits itself at once, with any unsaved changes in the submission, and keeps trying
  // briefly if the network drops. The database marks the sheet it accepted in time, never a later one.
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
    // Inert while a submission is in flight: the sheet being graded is the one on screen.
    if (sending.current) return
    const next = { ...answersRef.current, [itemId]: option }
    // The controller reads the clock now, not the countdown shown a moment ago: a tap after the cutoff, or without a
    // trustworthy reading, is refused before anything on screen changes, and the countdown is brought up to date.
    const sequence = autosave.current?.change(next) ?? null
    if (sequence === null) { setRemaining(remainingMs()); return }
    answersRef.current = next
    setAnswers(next)
  }

  if (result !== null) return <ExamReview questions={questions} result={result} />
  const question = questions[index]!
  const unanswered = questions.length - answered
  const saving = saveLine(save, timeUp)
  const clockLine = busy && !timeUp ? SUBMITTING
    : canAnswer || timeUp || save?.refusal === 'too-many-tabs' ? null : clockFailures > 1 ? RECONNECTING : CHECKING_CLOCK
  return <div className="grid gap-4">
    <div className="student-surface grid gap-1" role="timer" aria-live="off"
      data-urgency={remaining <= LOW_TIME_MS ? 'low' : undefined} data-clock-state={clockState}>
      <p className="student-detail-kicker">Time left</p>
      <p className={`text-2xl font-bold tabular-nums ${remaining <= LOW_TIME_MS ? 'text-student-error'
        : 'text-student-text-primary'}`}>{timeUp ? 'Time is up' : clock(remaining)}</p>
      <p className="student-meta">{answered} of {questions.length} answered</p>
      <p className="student-meta" role="status" data-save-state={save?.state ?? 'idle'}>
        {clockLine ?? saving.text} {DEADLINE_RULE}
      </p>
      {saving.retry && <div><button type="button" onClick={() => autosave.current?.retry()}
        className={studentAction(btnGhost, 'bg-student-surface')}>Save now</button></div>}
    </div>
    <fieldset className="student-surface" key={question.item_id} disabled={!canAnswer} aria-busy={busy || undefined}>
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
              className={studentAction(btnNavy, studentFocusDark)}>{busy ? SUBMITTING : 'Submit'}</button>
          </div>
        </>
        : <button type="button" disabled={busy}
          onClick={() => { if (unanswered > 0 && !timeUp) setConfirming(true); else void submit() }}
          className={studentAction(btnNavy, studentFocusDark, 'w-full tablet:w-auto')}>
          {busy ? SUBMITTING : timeUp ? 'See my result' : 'Submit exam'}
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
