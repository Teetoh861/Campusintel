'use client'
// app/courses/[slug]/quiz/ActiveAttempt.tsx — One open server-run practice attempt. The browser holds only the pinned
// prompts and options; the database fixed the deadline at start, keeps the sheet saved before it and grades it once,
// and only then returns correct options and explanations. The rules are the Discovery exam's, shared:
//   * time: lib/entitlements/exam-clock.ts. A fresh exchange with the server on mount and whenever the page comes back
//     into view, the whole round trip charged as elapsed, measured on the monotonic clock; until it lands, answers
//     cannot change. The device's wall clock is never the authority.
//   * saving: lib/entitlements/exam-autosave.ts, as this tab's changed questions over the revision it last received,
//     under a tab identity kept across reloads and never shared with a duplicated tab (lib/entitlements/exam-tab.ts).
//   * at zero the attempt submits itself and keeps trying while offline; the server grades only what it accepted in
//     time, and the result says so when this tab still held answers it never received.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExamAutosave } from '@/lib/entitlements/exam-autosave'
import { ExamClock } from '@/lib/entitlements/exam-clock'
import { browserTabOptions, claimExamTabOnce } from '@/lib/entitlements/exam-tab'
import { postPracticeCommand } from '@/lib/practice/client'
import { AssessmentConfirmation } from './AssessmentConfirmation'
import { QuestionScreen } from './QuestionScreen'
import { focusFirst } from './focus-return'
import { LOW_TIME_SECONDS, exitBodyFor, saveLineFor } from './practice-presentation'
import { clearUnsent, readFlags, readUnsent, writeFlags, writeUnsent } from './practice-storage'
import type { AutosaveSnapshot, SaveOutcome } from '@/lib/entitlements/exam-autosave'
import type { ClockReading, ClockState } from '@/lib/entitlements/exam-clock'
import type { ExamTab } from '@/lib/entitlements/exam-tab'
import type { GradedAttempt, OpenAttempt, PracticeResult, PracticeSheet } from '@/lib/practice/contract'
import type { ReturnFocus } from './focus-return'
import type { ReactElement } from 'react'

const TICK_MS = 1000
// When time is up, the grade is asked for again while the network is down.
const RETRY_MS = 10_000
const MAX_AUTO_RETRIES = 30
const NO_RETURN_FOCUS: ReturnFocus = []
const REFUSAL: Record<string, string> = {
  'too-many-tabs': 'You have too many practice tabs open. Continue in one of your other tabs — nothing you’ve answered there is lost.',
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'signed-out': 'You’ve been signed out. Sign in again to continue — the timer is still running.',
  'not-found': 'This attempt is no longer available.',
}
const RETRY = 'Something went wrong. Try again.'

type Props = {
  continuityToken: string
  courseCode: string
  courseTitle: string
  repositoryOnly: boolean
  courseHref: string
  attempt: OpenAttempt
  /** The server's clock when this attempt was read, for the display-only countdown before the first exchange. */
  serverNow: string
  onGraded: (attempt: GradedAttempt, unsentAtDeadline: boolean) => void
}

function validSheet(answers: PracticeSheet, options: ReadonlyMap<string, number>): PracticeSheet {
  return Object.fromEntries(Object.entries(answers).filter(([id, index]) => index < (options.get(id) ?? 0)))
}

export function ActiveAttempt(props: Props): ReactElement {
  const { attempt, continuityToken, courseHref, onGraded } = props
  const storageKey = `practice-attempt:${attempt.id}`
  const options = useMemo(() => new Map(attempt.questions.map(question => [question.questionId, question.options.length])),
    [attempt.questions])
  const initialRemaining = Date.parse(attempt.deadlineAt) - Date.parse(props.serverNow)
  const [answers, setAnswers] = useState<PracticeSheet>(() => validSheet(attempt.saved.answers, options))
  const [current, setCurrent] = useState(0)
  const [flags, setFlags] = useState<ReadonlySet<string>>(() => new Set())
  const [remaining, setRemaining] = useState(initialRemaining)
  const [clockState, setClockState] = useState<ClockState>('unsynced')
  const [clockFailures, setClockFailures] = useState(0)
  const [save, setSave] = useState<AutosaveSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitFailing, setSubmitFailing] = useState(false)
  const [confirm, setConfirm] = useState<'submit' | 'exit' | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [identity, setIdentity] = useState<ExamTab | null>(null)
  const answersRef = useRef(answers)
  const autosave = useRef<ExamAutosave | null>(null)
  const examClock = useRef<ExamClock | null>(null)
  const mounted = useRef<number | null>(null)
  const sending = useRef(false)
  const graded = useRef(false)
  const autoRetries = useRef(0)
  const returnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)
  const tab = identity?.tab ?? null
  const timeUp = remaining <= 0
  const canAnswer = clockState === 'synced' && !timeUp && !busy && refusal === null

  // Flags live on this device only (D2), per attempt; read after mount so the server render never depends on storage.
  useEffect(() => { setFlags(readFlags(attempt.id, attempt.questions.map(question => question.questionId))) },
    [attempt.id, attempt.questions])

  const remainingMs = useCallback((): number => {
    const trusted = examClock.current?.remaining() ?? null
    if (trusted !== null) return trusted
    return mounted.current === null ? initialRemaining : initialRemaining - (performance.now() - mounted.current)
  }, [initialRemaining])

  // The graded attempt replaces this screen once, whichever request learnt of it first.
  const finish = useCallback((result: GradedAttempt) => {
    if (graded.current) return
    graded.current = true
    const pending = autosave.current
    const unsent = result.result.timedOut && pending !== null && pending.snapshot().state !== 'saved' &&
      pending.unsent().dirty.length > 0
    pending?.stop()
    clearUnsent(attempt.id)
    onGraded(result, unsent)
  }, [attempt.id, onGraded])

  const refuse = useCallback((outcome: PracticeResult) => {
    if (outcome.status === 'graded' && outcome.attempt.status !== 'in_progress') { finish(outcome.attempt); return }
    if (outcome.status !== 'unavailable') setRefusal(REFUSAL[outcome.status] ?? RETRY)
  }, [finish])

  useEffect(() => {
    // Held for the life of the page (claimExamTabOnce), so a remount reuses it and a duplicated tab is still answered.
    let live = true
    void claimExamTabOnce(browserTabOptions(storageKey)).then(next => { if (live) setIdentity(next) })
    return () => { live = false }
  }, [storageKey])

  useEffect(() => {
    if (tab === null) return
    mounted.current = performance.now()
    const sync = async (): Promise<ClockReading | null> => {
      const outcome = await postPracticeCommand({ action: 'sync', attemptId: attempt.id, tab }, continuityToken)
      if (outcome.status === 'saved' || outcome.status === 'stale' || outcome.status === 'too-many-tabs') {
        autosave.current?.adopt({ revision: outcome.revision, answers: validSheet(outcome.answers, options) })
        return { serverNow: Date.parse(outcome.now), deadline: Date.parse(outcome.deadlineAt) }
      }
      refuse(outcome)
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
  }, [tab, attempt.id, continuityToken, options, remainingMs, refuse])

  useEffect(() => {
    if (identity === null) return
    const send = async (delta: { tab: string; sequence: number; baseRevision: number; changes: Record<string, number | null> })
      : Promise<SaveOutcome> => {
      const changes = Object.fromEntries(Object.entries(delta.changes).filter((entry): entry is [string, number] =>
        entry[1] !== null))
      const outcome = await postPracticeCommand({ action: 'save', attemptId: attempt.id, tab: delta.tab,
        sequence: delta.sequence, baseRevision: delta.baseRevision, changes }, continuityToken)
      if (outcome.status === 'saved' || outcome.status === 'stale') {
        return { kind: outcome.status, revision: outcome.revision, answers: validSheet(outcome.answers, options) }
      }
      if (outcome.status === 'too-many-tabs') {
        setRefusal(REFUSAL['too-many-tabs']!)
        return { kind: 'refused', status: outcome.status,
          sheet: { revision: outcome.revision, answers: validSheet(outcome.answers, options) } }
      }
      if (outcome.status === 'unavailable') return { kind: 'failed' }
      refuse(outcome)
      return { kind: 'refused', status: outcome.status === 'graded' ? 'closed' : outcome.status }
    }
    let controller: ExamAutosave | null = null
    controller = new ExamAutosave({
      tab: identity.tab, startSequence: identity.sequence, onSequence: sequence => identity.remember(sequence),
      server: { revision: attempt.saved.revision, answers: validSheet(attempt.saved.answers, options) },
      restored: readUnsent(attempt.id, options),
      remaining: () => examClock.current?.remaining() ?? null, send,
      schedule: (run, ms) => window.setTimeout(run, ms), cancel: handle => window.clearTimeout(handle as number),
      onChange: snapshot => {
        setSave(snapshot)
        if (controller !== null && !graded.current) writeUnsent(attempt.id, controller.unsent())
      },
      onRebase: merged => { answersRef.current = merged as PracticeSheet; setAnswers(merged as PracticeSheet) },
    })
    autosave.current = controller
    const sheet = controller.unsent().answers as PracticeSheet
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
  }, [identity, attempt.id, attempt.saved, continuityToken, options, refuse])

  /** Grade now, with this tab's pending changes. True when nothing more is to be tried. */
  const submit = useCallback(async (): Promise<boolean> => {
    if (sending.current || tab === null || graded.current) return graded.current
    sending.current = true
    setBusy(true)
    setSubmitFailing(false)
    const pending = autosave.current?.delta() ?? { tab, sequence: 0, baseRevision: 0, changes: {} }
    const changes = Object.fromEntries(Object.entries(pending.changes).filter((entry): entry is [string, number] =>
      entry[1] !== null))
    const outcome = await postPracticeCommand({ action: 'submit', attemptId: attempt.id, tab: pending.tab,
      sequence: pending.sequence, baseRevision: pending.baseRevision, changes }, continuityToken)
    sending.current = false
    setConfirm(null)
    if (outcome.status === 'graded' && outcome.attempt.status !== 'in_progress') { finish(outcome.attempt); return true }
    setBusy(false)
    if (outcome.status === 'unavailable') { setSubmitFailing(true); return false }
    refuse(outcome)
    return true
  }, [tab, attempt.id, continuityToken, finish, refuse])

  // At zero the attempt submits itself at once and keeps asking while the network is down.
  useEffect(() => {
    if (!timeUp || graded.current) return
    let cancelled = false
    async function attemptSubmit(): Promise<void> {
      if (cancelled || await submit() || autoRetries.current >= MAX_AUTO_RETRIES) return
      autoRetries.current += 1
      window.setTimeout(() => { void attemptSubmit() }, RETRY_MS)
    }
    void attemptSubmit()
    return () => { cancelled = true }
  }, [timeUp, submit])

  const question = attempt.questions[current]!
  const answersMap = Object.fromEntries(attempt.questions.flatMap((item, index) =>
    answers[item.questionId] === undefined ? [] : [[index, answers[item.questionId]!]]))
  const markedMap = Object.fromEntries(attempt.questions.flatMap((item, index) => flags.has(item.questionId) ? [[index, true]] : []))
  const answered = Object.keys(answersMap).length
  const timeLeft = clockState === 'synced' ? Math.max(0, Math.ceil(remaining / 1000)) : null

  function choose(option: number): void {
    if (sending.current) return
    const next = { ...answersRef.current, [question.questionId]: option }
    // The controller reads the clock now: a tap after the cutoff, or without a trustworthy reading, changes nothing.
    if ((autosave.current?.change(next) ?? null) === null) { setRemaining(remainingMs()); return }
    answersRef.current = next
    setAnswers(next)
  }

  function toggleFlag(): void {
    const next = new Set(flags)
    if (next.has(question.questionId)) next.delete(question.questionId)
    else next.add(question.questionId)
    setFlags(next)
    writeFlags(attempt.id, next)
  }

  function exit(): void {
    void autosave.current?.flush()
    window.location.assign(courseHref)
  }

  const restore = (event: Event) => { if (focusFirst(returnFocus.current)) event.preventDefault() }
  const saveState = save === null ? null : save.state

  return <>
    <QuestionScreen courseCode={props.courseCode} courseTitle={props.courseTitle} repositoryOnly={props.repositoryOnly}
      question={question} current={current} total={attempt.questions.length} selected={answers[question.questionId]}
      isMarked={flags.has(question.questionId)} timeLeft={timeLeft}
      isLowTime={timeLeft !== null && timeLeft <= LOW_TIME_SECONDS} canAnswer={canAnswer}
      saveLine={saveLineFor({ timeUp, submitFailing, refusal, clockSynced: clockState === 'synced', clockFailures,
        save: saveState, answered })}
      onRetrySave={() => autosave.current?.retry()}
      navOpen={navOpen} answeredCount={answered} markedCount={flags.size} answersMap={answersMap} markedMap={markedMap}
      onSelectOption={choose} onToggleMark={toggleFlag}
      onPrev={() => setCurrent(index => Math.max(0, index - 1))}
      onNext={() => setCurrent(index => Math.min(attempt.questions.length - 1, index + 1))}
      onJump={index => { setCurrent(index); setNavOpen(false) }}
      onSubmit={focus => { returnFocus.current = focus; setConfirm('submit') }}
      onOpenNav={() => setNavOpen(true)} onCloseNav={() => setNavOpen(false)}
      onLeave={focus => { returnFocus.current = focus; setConfirm('exit') }} />
    <AssessmentConfirmation kind="submit" open={confirm === 'submit'} onOpenChange={open => setConfirm(open ? 'submit' : null)}
      answered={answered} unanswered={attempt.questions.length - answered} flagged={flags.size}
      pending={saveState !== null && saveState !== 'saved'} onConfirm={() => { void submit() }} onRestoreFocus={restore} />
    <AssessmentConfirmation kind="exit" open={confirm === 'exit'} onOpenChange={open => setConfirm(open ? 'exit' : null)}
      body={exitBodyFor(saveState, answered)} onConfirm={exit} onRestoreFocus={restore} />
  </>
}
