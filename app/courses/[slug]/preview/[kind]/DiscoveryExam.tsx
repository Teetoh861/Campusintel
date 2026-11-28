'use client'
// app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx — The Discovery Pass CBT exam. The browser holds only the
// questions; the database fixed the deadline when the exam opened, keeps the sheet saved before it, and grades the
// answers once and returns only the score. Nothing sent after the deadline is marked.
// Whether a tap may still change an answer is decided by lib/entitlements/exam-clock.ts: a fresh exchange with the
// server on mount (and again whenever the page comes back into view), with the whole round trip charged as elapsed
// and the time since measured on the monotonic clock, so the cutoff here is never later than the real deadline and
// the device's wall clock is never the authority. A page rendered on the server seeds that clock with its own reading,
// timed by its navigation, so the time left shows and answers can change from the first render; otherwise answers wait
// for the first exchange. The clock is read at the moment of the tap, not from the once-a-second countdown, and a
// refused tap changes nothing on screen.
// Answers are saved as the student goes through lib/entitlements/exam-autosave.ts: only the questions this tab
// changed, over the revision it last received, so another tab's answers are never overwritten; the database answers
// with the sheet that stands and this tab shows it. What is not saved yet stays on this device and is retried for as
// long as the exam is open, at once when the connection comes back. With time left, a submission is sent at once and
// carries the same pending changes (no wait for a save in flight), and the database grades the sheet it holds once they
// are laid over it; at time up every hand-in, automatic or tapped, waits for the server's deadline. Once the student
// hands the exam in, the answer controls are inert, so the screen cannot drift from what is being graded.
// Leaving ends the exam: Exit and the back button ask "End exam?", the same as a practice exam, and while the exam is on
// screen the site's header and footer are hidden. "Saved" is shown only once the server confirmed this tab's latest
// change.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { EndExamDialog } from '@/components/student/EndExamDialog'
import { useExamBackGuard } from '@/components/student/exam-back-guard'
import { tapGuardProps, useTapGuardTimeout } from '@/components/student/tap-guard'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { SIGNED_IN_ON_ANOTHER_TAB } from '@/lib/auth/constants'
import { accessCopy } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { postDiscoveryCommand } from '@/lib/entitlements/client'
import { sampleAnswers } from '@/lib/entitlements/discovery-contract'
import { ExamAutosave } from '@/lib/entitlements/exam-autosave'
import { ExamClock, browserDocumentTiming, documentClockSeed } from '@/lib/entitlements/exam-clock'
import { browserTabOptions, claimExamTabOnce } from '@/lib/entitlements/exam-tab'
import type { SampleAnswers, SampleQuestion, SampleResult, SavedSheet, SheetDelta } from '@/lib/entitlements/discovery-contract'
import type { AutosaveSnapshot, SaveOutcome, UnsentSheet } from '@/lib/entitlements/exam-autosave'
import type { ClockReading, ClockState } from '@/lib/entitlements/exam-clock'
import type { ExamTab } from '@/lib/entitlements/exam-tab'
import type { ReactElement } from 'react'

const optionLetter = (index: number) => String.fromCharCode(65 + index)
const TICK_MS = 1000
// When time is up, the marked result is fetched again if the network drops, inside the server's replay window; a
// hand-in the student asked for with time left is asked again after the same wait.
const RETRY_MS = 10_000
const MAX_AUTO_RETRIES = 10
const LOW_TIME_MS = 5 * 60_000
const noSubscription = () => () => {}

const REFUSAL: Record<string, string> = {
  'expired': 'Your free pass has ended, so this exam’s result can no longer be shown.',
  // This tab identity cannot save on this exam (the exam already takes changes from as many tabs as it allows).
  // Saving stops in this tab only; every other tab, and everything already saved, is untouched.
  'too-many-tabs': 'This exam is open in another tab. Continue there.',
  'session-changed': SIGNED_IN_ON_ANOTHER_TAB,
  'signed-out': 'You’ve been signed out. Sign in before time runs out.',
}
const RETRY = 'We couldn’t send your answers. They’re still here.'
// A submission that did not go through with time left: what was confirmed stays saved, the rest stays on this page,
// so the one thing to do is keep it open. The submit button right above the line is the way on.
const SUBMIT_RETRY = 'We couldn’t submit your answers. Keep this page open and try again.'

/** One line under the exam and where it came from: a sync problem goes once a later sync succeeds, a submission problem
 * stays until the next submission. Signing in or loading the page again comes back to this exam. */
type ExamLine = { text: string; from: 'sync' | 'submit'; action?: { label: string; href: string } }
function refusalLine(status: string, from: ExamLine['from']): ExamLine {
  const page = window.location.pathname
  const action = status === 'signed-out' ? { label: 'Sign in', href: `/login?next=${encodeURIComponent(page)}` }
    : status === 'session-changed' ? { label: 'Reload', href: page } : undefined
  return { text: REFUSAL[status] ?? RETRY, from, action }
}
const SUBMITTING = 'Submitting…'
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
function saveLine(save: AutosaveSnapshot | null, timeUp: boolean): string {
  if (save === null) return ''
  if (timeUp || save.state === 'closed') {
    return save.revision === 0 ? 'No answers were chosen before time ran out.'
      : save.savedRevision >= save.revision ? 'Your answers were saved before time ran out.'
        : 'Your last change may not have been saved before time ran out.'
  }
  switch (save.state) {
    case 'saved': return save.savedRevision === 0 ? '' : 'All answers saved.'
    case 'saving': return 'Saving…'
    // Retried until it is saved, and at once when the connection comes back.
    case 'unsaved': return 'Not saved yet.'
    case 'failed': return REFUSAL[save.refusal ?? ''] ?? 'Your answers can’t be saved any more. Submit to see what was marked.'
  }
}

export function DiscoveryExam({ continuityToken, courseSlug, courseHref, questions, deadlineAt, serverNow, savedSheet,
  initialResult, plansOnSale = false }: {
  continuityToken: string
  /** The copy switch (plans_on_sale): Subscribe beside the score once plans are on sale. */
  plansOnSale?: boolean
  courseSlug: string
  /** The course page: Back to course under the result. */
  courseHref: string
  questions: ReadonlyArray<SampleQuestion>
  deadlineAt: string
  serverNow: string
  /** The sheet the database holds for the open exam, and its revision; null once the exam is graded. */
  savedSheet: SavedSheet | null
  initialResult: SampleResult | null
}): ReactElement {
  const storageKey = `discovery-exam:${courseSlug}:${deadlineAt}`
  // The countdown from the first render: the page's reading of the server clock, as it was rendered.
  const initialRemaining = Date.parse(deadlineAt) - Date.parse(serverNow)
  // Rendered on the server and hydrated: the page's own navigation timed that reading. Decided on the first render.
  const hydrating = useSyncExternalStore(noSubscription, () => false, () => true)
  const fromDocument = useRef(hydrating)
  const [answers, setAnswers] = useState<SampleAnswers>(() => validAnswers(savedSheet?.answers ?? {}, questions))
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<SampleResult | null>(initialResult)
  // A result that replaces the exam under the student's finger ignores taps for a moment (tap-guard.ts); one shown
  // with the page (initialResult) never does.
  const [tapGuard, setTapGuard] = useState(false)
  useTapGuardTimeout(tapGuard, setTapGuard)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [clockState, setClockState] = useState<ClockState>('unsynced')
  const [clockFailures, setClockFailures] = useState(0)
  const [save, setSave] = useState<AutosaveSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  // Time is up here and the hand-in is waiting for the server's deadline (the button says Submitting… meanwhile).
  const [awaitingDeadline, setAwaitingDeadline] = useState(false)
  // The student handed the exam in (End and see results, or Submit): the answers stay as they are from here on, and
  // a hand-in that did not go through is asked again.
  const [ending, setEnding] = useState(false)
  const [submitFailing, setSubmitFailing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [message, setMessage] = useState<ExamLine | null>(null)
  const answersRef = useRef(answers)
  const autosave = useRef<ExamAutosave | null>(null)
  const examClock = useRef<ExamClock | null>(null)
  // The page clock when the exam mounted, for the countdown until the clock has a trustworthy reading.
  const mounted = useRef<number | null>(null)
  const sending = useRef(false)
  const autoRetries = useRef(0)
  const exitButton = useRef<HTMLButtonElement>(null)
  const timeUp = remaining <= 0
  // Answers can change only with a trustworthy clock reading, before the cutoff, and until the student hands the exam
  // in: from then on the sheet on screen is the sheet being graded.
  const canAnswer = clockState === 'synced' && !timeUp && !busy && !ending && save?.refusal !== 'too-many-tabs'
  const answered = Object.keys(answers).length

  // The trustworthy reading when there is one; otherwise the countdown from the rendered values.
  const remainingMs = useCallback((): number => {
    const trusted = examClock.current?.remaining() ?? null
    if (trusted !== null) return trusted
    return mounted.current === null ? initialRemaining : initialRemaining - (performance.now() - mounted.current)
  }, [initialRemaining])

  // This tab's identity for the database's sequence ledger: kept across reloads of this tab (so reloads never use up
  // the exam's tab capacity) and never shared with a duplicated tab (lib/entitlements/exam-tab.ts).
  const [identity, setIdentity] = useState<ExamTab | null>(null)
  const tab = identity?.tab ?? null
  const handingIn = ending || busy || awaitingDeadline || timeUp

  // The back button asks "End exam?" too, while the exam is on screen and not already being handed in.
  const onBack = useCallback(() => setEndOpen(true), [])
  const releaseBack = useExamBackGuard(storageKey, result === null, handingIn || identity === null, onBack)
  useEffect(() => { if (result !== null) releaseBack() }, [result, releaseBack])

  useEffect(() => {
    if (initialResult !== null) return
    // Held for the life of the page (claimExamTabOnce), so a remount reuses it and a duplicated tab is still answered.
    let live = true
    void claimExamTabOnce(browserTabOptions(storageKey)).then(next => { if (live) setIdentity(next) })
    return () => { live = false }
  }, [initialResult, storageKey])

  // The countdown runs from the first render, before the clock has its own reading.
  useEffect(() => {
    if (initialResult !== null) return
    mounted.current = performance.now()
    const timer = window.setInterval(() => setRemaining(remainingMs()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [initialResult, remainingMs])

  // The clock: seeded with the page's reading when it was rendered on the server, a fresh exchange on mount, again
  // whenever the page comes back into view, and retried after a failure (at once when the connection comes back).
  useEffect(() => {
    if (initialResult !== null || tab === null) return
    const reading = { serverNow: Date.parse(serverNow), deadline: Date.parse(deadlineAt) }
    const seed = fromDocument.current ? documentClockSeed(reading, browserDocumentTiming(), performance.now()) : null
    const sync = async (): Promise<ClockReading | null> => {
      const outcome = await postDiscoveryCommand({ action: 'sync-exam', courseSlug, tab }, continuityToken)
      if (outcome.status === 'saved' || outcome.status === 'stale' || outcome.status === 'too-many-tabs') {
        // The sheet that stands, from every tab, laid under this tab's unconfirmed changes.
        autosave.current?.adopt({ revision: outcome.revision, answers: validAnswers(outcome.answers, questions) })
        // Back in touch with the server: an earlier sync problem no longer applies.
        setMessage(previous => previous?.from === 'sync' ? null : previous)
        return { serverNow: Date.parse(outcome.now), deadline: Date.parse(outcome.deadlineAt) }
      }
      if (outcome.status === 'ready') {
        if (outcome.preview.kind === 'cbt' && outcome.preview.result !== null) { setResult(outcome.preview.result); setTapGuard(true) }
        return null
      }
      if (outcome.status !== 'unavailable') setMessage(refusalLine(outcome.status, 'sync'))
      return null
    }
    const controller = new ExamClock({
      monotonic: () => performance.now(), wall: () => Date.now(), sync, seed,
      schedule: (run, ms) => window.setTimeout(run, ms), cancel: handle => window.clearTimeout(handle as number),
      onChange: state => {
        setClockState(state)
        setClockFailures(failures => state === 'synced' ? 0 : failures + 1)
        setRemaining(remainingMs())
      },
    })
    examClock.current = controller
    setClockState(controller.state())
    setRemaining(remainingMs())
    controller.start()
    // Back into view after being hidden: the device may have slept, so the reading is read again before any tap.
    const visible = () => { if (document.visibilityState === 'visible') controller.invalidate() }
    const online = () => { if (controller.state() === 'unsynced') controller.resync() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', online)
    return () => {
      controller.stop()
      examClock.current = null
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', online)
    }
  }, [initialResult, courseSlug, tab, continuityToken, questions, remainingMs, serverNow, deadlineAt])

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
        if (outcome.preview.kind === 'cbt' && outcome.preview.result !== null) { setResult(outcome.preview.result); setTapGuard(true) }
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
    // Leaving the page or switching apps sends whatever is unsaved (with keepalive, so it completes); the connection
    // coming back sends it at once.
    const flush = () => { void controller.flush() }
    const hidden = () => { if (document.visibilityState === 'hidden') void controller.flush() }
    const online = () => { controller.retry() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      controller.stop()
      autosave.current = null
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [initialResult, savedSheet, storageKey, questions, courseSlug, continuityToken, identity])

  const submit = useCallback(async (): Promise<boolean> => {
    if (sending.current || tab === null) return false
    sending.current = true
    setBusy(true)
    setSubmitFailing(false)
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
      setTapGuard(true)
      try { window.sessionStorage.removeItem(storageKey) } catch { /* Nothing to clear. */ }
      return true
    }
    sending.current = false
    setBusy(false)
    setConfirming(false)
    setEndOpen(false)
    if (outcome.status === 'unavailable') {
      setSubmitFailing(true)
      setMessage({ text: SUBMIT_RETRY, from: 'submit' })
      return false
    }
    setMessage(refusalLine(outcome.status, 'submit'))
    return true
  }, [continuityToken, courseSlug, storageKey, tab])

  /**
   * A hand-in the student asks for: End and see results, Submit, or See your result. From here on the answers stay as
   * they are. With time left on this device (or no reading to wait on) it goes at once. Once this device's zero has
   * passed it goes with the time-up hand-in below, which waits for the server's deadline: sent before it, the exam is
   * still open there and its result would not say that time ran out. The clock is read at the tap, not from the
   * countdown shown a moment ago, so a tap just after zero waits too; the countdown is brought up to date, which starts
   * that hand-in.
   */
  const handIn = useCallback((): void => {
    setEnding(true)
    const left = examClock.current?.remaining() ?? null
    if (left === null || left > 0 || Math.max(0, examClock.current?.untilPassed() ?? 0) === 0) { void submit(); return }
    setRemaining(remainingMs())
  }, [submit, remainingMs])

  // A hand-in the student asked for that did not reach the server, with time left: asked again after a wait, and at
  // once when the connection comes back. Time running out hands it over to the time-up hand-in below.
  useEffect(() => {
    if (!ending || !submitFailing || timeUp || result !== null) return
    const again = () => { void submit() }
    const timer = window.setTimeout(again, RETRY_MS)
    window.addEventListener('online', again)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', again)
    }
  }, [ending, submitFailing, timeUp, result, submit])

  // At this device's zero the answers lock and anything unsaved is sent. The exam is handed in once the deadline has
  // passed on the server too: this device's zero can come up to one clock exchange early, and an exam handed in then
  // is still open there, so its result would not say that time ran out. While it waits the button says Submitting…
  // (a tap joins this hand-in, see handIn). It keeps trying briefly if the network drops. The database marks the
  // sheet it accepted in time, never a later one.
  useEffect(() => {
    if (!timeUp || result !== null) return
    let cancelled = false
    let timer: number | null = null
    async function attempt(): Promise<void> {
      timer = null
      if (cancelled) return
      const wait = Math.max(0, examClock.current?.untilPassed() ?? 0)
      if (wait > 0) {
        setAwaitingDeadline(true)
        timer = window.setTimeout(() => { void attempt() }, wait)
        return
      }
      setAwaitingDeadline(false)
      if (await submit() || cancelled || autoRetries.current >= MAX_AUTO_RETRIES) return
      autoRetries.current += 1
      timer = window.setTimeout(() => { void attempt() }, RETRY_MS)
    }
    void autosave.current?.flush()
    void attempt()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      setAwaitingDeadline(false)
    }
  }, [timeUp, result, submit])

  function choose(itemId: string, option: number): void {
    // Inert once the exam is handed in: the sheet being graded is the one on screen.
    if (sending.current || ending) return
    const next = { ...answersRef.current, [itemId]: option }
    // The controller reads the clock now, not the countdown shown a moment ago: a tap after the cutoff, or without a
    // trustworthy reading, is refused before anything on screen changes, and the countdown is brought up to date.
    const sequence = autosave.current?.change(next) ?? null
    if (sequence === null) { setRemaining(remainingMs()); return }
    answersRef.current = next
    setAnswers(next)
  }

  if (result !== null) return <ExamReview result={result} plansOnSale={plansOnSale} courseHref={courseHref} tapGuard={tapGuard} />
  const handInPending = busy || awaitingDeadline
  const question = questions[index]!
  const unanswered = questions.length - answered
  const clockLine = busy && !timeUp ? SUBMITTING
    : canAnswer || timeUp || ending || save?.refusal === 'too-many-tabs' || clockFailures <= 1 ? null : RECONNECTING
  const restoreToExit = (event: Event) => {
    if (exitButton.current?.isConnected && !exitButton.current.disabled) { event.preventDefault(); exitButton.current.focus() }
  }
  // data-exam-open: the site's header and footer stay hidden from the first paint (student-app.css).
  return <div className="grid gap-4" data-exam-open="">
    <div className="student-surface grid gap-1" data-urgency={remaining <= LOW_TIME_MS ? 'low' : undefined}
      data-clock-state={clockState}>
      <div className="flex items-start justify-between gap-3">
        <div role="timer" aria-live="off">
          <p className="student-detail-kicker">Time left</p>
          <p className={`text-2xl font-bold tabular-nums ${remaining <= LOW_TIME_MS ? 'text-student-error'
            : 'text-student-text-primary'}`}>{timeUp ? 'Time is up' : clock(remaining)}</p>
        </div>
        <button ref={exitButton} type="button" aria-haspopup="dialog" disabled={handingIn || identity === null}
          onClick={() => setEndOpen(true)} className={studentAction(btnGhost, 'bg-student-surface')}>Exit</button>
      </div>
      <p className="student-meta">{answered} of {questions.length} answered</p>
      <p className="student-meta" role="status" data-save-state={save?.state ?? 'idle'}>
        {clockLine ?? saveLine(save, timeUp)}
      </p>
    </div>
    <fieldset className="student-surface" key={question.item_id} disabled={!canAnswer} aria-busy={handInPending || undefined}>
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
      {/* As many columns as fit with every number at least 44 px wide, and each 44 px tall: a touch target at any width. */}
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
        {questions.map((item, position) => <li key={item.item_id}>
          <button type="button" onClick={() => setIndex(position)} aria-current={position === index ? 'step' : undefined}
            aria-label={`Question ${position + 1}${answers[item.item_id] === undefined ? ', unanswered' : ', answered'}`}
            className={`h-11 w-full rounded-md border text-sm font-semibold tabular-nums student-focus-control ${
              position === index ? 'border-student-primary text-student-primary'
                : answers[item.item_id] !== undefined ? 'border-transparent bg-student-brand-surface text-student-text-primary'
                  : 'border-student-border text-student-text-muted'}`}>{position + 1}</button>
        </li>)}
      </ol>
    </nav>
    <div className="grid gap-2">
      {confirming && !timeUp && !ending
        ? <>
          <p className="text-sm text-student-text-primary" role="status">
            {unanswered === 1 ? '1 question is' : `${unanswered} questions are`} unanswered. You can only submit once.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={studentAction(btnGhost, 'bg-student-surface')}>
              Keep going</button>
            <button type="button" disabled={handInPending} onClick={handIn}
              className={studentAction(btnNavy, studentFocusDark)}>{handInPending ? SUBMITTING : 'Submit'}</button>
          </div>
        </>
        : <button type="button" disabled={handInPending}
          onClick={() => { if (unanswered > 0 && !timeUp && !ending) setConfirming(true); else handIn() }}
          className={studentAction(btnNavy, studentFocusDark, 'w-full tablet:w-auto')}>
          {handInPending ? SUBMITTING : timeUp ? 'See your result' : 'Submit exam'}
        </button>}
      {message !== null && <p role="status" className="text-sm text-student-text-secondary">{message.text}
        {message.action ? <> <a href={message.action.href} className={studentAction(btnGhost, 'border-transparent px-2')}>
          {message.action.label}</a></> : null}</p>}
    </div>
    {/* It stays up, saying Submitting…, until the hand-in is done: the result replaces it, or submit closes it. */}
    <EndExamDialog open={endOpen} submitting={handInPending} onKeepGoing={() => setEndOpen(false)} onEnd={handIn}
      onRestoreFocus={restoreToExit} />
  </div>
}

function ExamReview({ result, plansOnSale, courseHref, tapGuard = false }: { result: SampleResult; plansOnSale: boolean
  courseHref: string; tapGuard?: boolean }): ReactElement {
  return <div className="grid gap-4" {...tapGuardProps(tapGuard)}>
    <section className="student-surface" aria-label="Exam result">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-student-text-secondary">Your score</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-student-text-primary">{result.score} of {result.total} correct</p>
      {result.timed_out ? <p className="mt-2 text-student-text-secondary">Time ran out.</p> : null}
    </section>
    <section className="student-surface grid gap-4 bg-student-brand-surface" aria-label="Answers">
      <p className="flex items-start gap-2.5 font-semibold text-student-text-primary">
        <Lock aria-hidden="true" size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        <span>{accessCopy(plansOnSale).answersLine}</span>
      </p>
      {plansOnSale && <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
        className={studentAction(btnNavy, studentFocusDark, 'justify-self-start')}>Subscribe</Link>}
    </section>
    <Link href={courseHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface', 'justify-self-start')}>
      Back to course
    </Link>
  </div>
}
