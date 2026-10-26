// QuizClient — the Practice screens around one server-run attempt: the briefing, the resume card, the attempt itself
// (ActiveAttempt), the result and the review. The server owns every attempt; this file only moves between screens.
// A start names a fresh attempt id kept on this device until the server answers, so a lost response is retried with
// the same id and never starts a second attempt. Every attempt has a reloadable URL (?attempt=<id>).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postPracticeCommand } from '@/lib/practice/client'
import { ActiveAttempt } from './ActiveAttempt'
import { IntroScreen } from './IntroScreen'
import { ReportQuestionDialog } from './ReportQuestionDialog'
import { ResultsScreen } from './ResultsScreen'
import { ResumeScreen } from './ResumeScreen'
import { ReviewScreen } from './ReviewScreen'
import { focusFirst } from './focus-return'
import { PRACTICE_COPY } from './practice-presentation'
import { clearPendingStart, markResultSeen, readPendingStart, resultSeen, writePendingStart } from './practice-storage'
import type { GradedAttempt, OpenAttempt, PracticeResult } from '@/lib/practice/contract'
import type { ReturnFocus } from './focus-return'
import type { PendingStart } from './practice-storage'
import type { PracticeBrief, ReportTarget } from './types'
import type { ReactElement } from 'react'

const START_TRIES = 3
const START_RETRY_MS = 1500
const NO_RETURN_FOCUS: ReturnFocus = []
type Problem = { title: string; body: string }
const PROBLEMS: Record<string, Problem> = {
  'start-failed': { title: PRACTICE_COPY.startFailedTitle, body: PRACTICE_COPY.startFailedBody },
  'policy-changed': { title: PRACTICE_COPY.changedTitle, body: PRACTICE_COPY.changedBody },
  'questions-changed': { title: 'These questions have changed.', body: 'Retake with new questions instead.' },
  'locked': { title: 'You can’t start a new attempt right now.', body: 'Your plan no longer includes this course. Your results are unaffected.' },
  'signed-out': { title: 'You’ve been signed out.', body: 'Sign in again to continue.' },
  'session-changed': { title: 'You signed in on another tab.', body: 'Refresh this page to continue.' },
}

export type QuizInitial =
  | { kind: 'intro' }
  | { kind: 'resume'; attemptId: string; answered: number; total: number; minutesLeft: number }
  | { kind: 'open'; attempt: OpenAttempt; now: string }
  // `latest`: the course's most recent graded attempt, shown in place of the briefing only if this device has not
  // shown it yet (time ran out while away, or a submission's response was lost).
  | { kind: 'graded'; attempt: GradedAttempt; latest: boolean }

type Props = {
  continuityToken: string
  courseCode: string
  courseTitle: string
  courseSlug: string
  courseHref: string
  repositoryOnly: boolean
  // Repository course UUID: the course selector the report backend validates.
  repositoryCourseId: string
  // The server's brief for a fresh attempt; null when no new attempt may start now (access or bank).
  brief: PracticeBrief | null
  bankSize: number
  lastResultHref: string | null
  initial: QuizInitial
}

type View =
  | { screen: 'intro' }
  | { screen: 'resume' }
  | { screen: 'active'; attempt: OpenAttempt; now: string }
  | { screen: 'results' | 'review'; attempt: GradedAttempt; unsent: boolean }

function initialView(initial: QuizInitial): View {
  if (initial.kind === 'resume') return { screen: 'resume' }
  if (initial.kind === 'open') return { screen: 'active', attempt: initial.attempt, now: initial.now }
  if (initial.kind === 'graded') return { screen: 'results', attempt: initial.attempt, unsent: false }
  return { screen: 'intro' }
}

export function QuizClient(props: Props): ReactElement | null {
  const { continuityToken, courseSlug, initial } = props
  const [view, setView] = useState<View>(() => initialView(initial))
  const [brief, setBrief] = useState(props.brief)
  const [bankSize, setBankSize] = useState(props.bankSize)
  const [briefingVersion, setBriefingVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [report, setReport] = useState<{ index: number; target: ReportTarget } | null>(null)
  const [reported, setReported] = useState<Readonly<Record<string, true>>>({})
  const reportReturnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)
  const starting = useRef(false)

  // Global chrome is hidden only while an attempt is on screen.
  useEffect(() => {
    document.body.setAttribute('data-screen', view.screen)
    return () => { document.body.removeAttribute('data-screen') }
  }, [view.screen])

  const show = useCallback((outcome: Extract<PracticeResult, { attempt: unknown }>) => {
    const { attempt } = outcome
    window.history.replaceState(null, '', `${window.location.pathname}?attempt=${attempt.id}`)
    setProblem(null)
    if (attempt.status === 'in_progress') setView({ screen: 'active', attempt, now: outcome.now })
    else setView({ screen: 'results', attempt, unsent: false })
  }, [])

  // A result this device has already shown is not shown again in place of the briefing. Decided once per mount, before
  // this mount marks it seen (effects may run twice), so the result is never replaced by the briefing it just showed.
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current) return
    decided.current = true
    if (initial.kind === 'graded' && initial.latest && props.brief !== null && resultSeen(initial.attempt.id)) {
      setView({ screen: 'intro' })
    }
  }, [initial, props.brief])
  useEffect(() => {
    if (view.screen === 'results' && decided.current) markResultSeen(view.attempt.id)
  }, [view])

  const begin = useCallback(async (pending: PendingStart) => {
    if (starting.current) return
    starting.current = true
    setBusy(true)
    setProblem(null)
    writePendingStart(courseSlug, pending)
    let outcome: PracticeResult = { status: 'unavailable' }
    for (let tries = 0; tries < START_TRIES; tries += 1) {
      outcome = await postPracticeCommand({ action: 'start', courseSlug, attemptId: pending.attemptId,
        intent: pending.intent, redoOf: pending.redoOf, expected: pending.expected }, continuityToken)
      if (outcome.status !== 'unavailable') break
      await new Promise(resolve => setTimeout(resolve, START_RETRY_MS * (tries + 1)))
    }
    starting.current = false
    setBusy(false)
    // Unanswered: the same attempt id is kept, so trying again (or reloading) can only find this start, never a second.
    if (outcome.status === 'unavailable') { setProblem(PROBLEMS['start-failed']!); return }
    clearPendingStart(courseSlug)
    if (outcome.status === 'ready' || outcome.status === 'in-progress' || outcome.status === 'graded') { show(outcome); return }
    if (outcome.status === 'policy-changed') {
      setBrief({ questionCount: outcome.questionCount, durationSeconds: outcome.durationSeconds })
      setBankSize(outcome.bankSize)
      setBriefingVersion(version => version + 1)
      setView({ screen: 'intro' })
    }
    setProblem(PROBLEMS[outcome.status] ?? PROBLEMS['start-failed']!)
  }, [courseSlug, continuityToken, show])

  const start = useCallback((intent: 'new' | 'redo', redoOf: string | null, expected: PracticeBrief) => {
    const kept = readPendingStart(courseSlug)
    const same = kept !== null && kept.intent === intent && kept.redoOf === redoOf
    void begin(same ? kept : { attemptId: crypto.randomUUID(), intent, redoOf,
      expected: { ...expected, wholeBank: bankSize <= expected.questionCount } })
  }, [courseSlug, begin, bankSize])

  // A start whose response was lost before a reload: ask for that same attempt instead of offering a new one.
  useEffect(() => {
    if (initial.kind !== 'intro' && !(initial.kind === 'graded' && initial.latest)) return
    const kept = readPendingStart(courseSlug)
    if (kept === null) return
    void (async () => {
      const outcome = await postPracticeCommand({ action: 'attempt', attemptId: kept.attemptId }, continuityToken)
      if (outcome.status === 'ready' || outcome.status === 'graded') { clearPendingStart(courseSlug); show(outcome) }
      else if (outcome.status === 'not-found') clearPendingStart(courseSlug)
    })()
  }, [initial, courseSlug, continuityToken, show])

  const resume = useCallback(async () => {
    if (initial.kind !== 'resume') return
    setBusy(true)
    setProblem(null)
    const outcome = await postPracticeCommand({ action: 'attempt', attemptId: initial.attemptId }, continuityToken)
    setBusy(false)
    if (outcome.status === 'ready' || outcome.status === 'graded') show(outcome)
    else setProblem(PROBLEMS[outcome.status] ?? PROBLEMS['start-failed']!)
  }, [initial, continuityToken, show])

  const onGraded = useCallback((attempt: GradedAttempt, unsent: boolean) => {
    setView({ screen: 'results', attempt, unsent })
  }, [])

  const identity = { courseCode: props.courseCode, courseTitle: props.courseTitle, repositoryOnly: props.repositoryOnly }

  if (view.screen === 'active') {
    return <ActiveAttempt key={view.attempt.id} {...identity} continuityToken={continuityToken} courseHref={props.courseHref}
      attempt={view.attempt} serverNow={view.now} onGraded={onGraded} />
  }
  if (view.screen === 'resume' && initial.kind === 'resume') {
    return <ResumeScreen {...identity} courseHref={props.courseHref} answered={initial.answered} total={initial.total}
      minutesLeft={initial.minutesLeft} opening={busy} error={problem?.title ?? null} onContinue={() => { void resume() }} />
  }
  if (view.screen === 'review') {
    const { attempt } = view
    return <>
      <ReviewScreen {...identity} questions={attempt.questions} correctCount={attempt.result.score} reported={reported}
        reporting={report ? report.index : null}
        onReport={(index, returnFocusTo) => {
          const question = attempt.questions[index]
          if (!question) return
          reportReturnFocus.current = returnFocusTo
          setReport({ index, target: { courseId: props.repositoryCourseId, itemId: question.itemId,
            revision: question.revision, questionId: question.questionId, attemptId: attempt.id } })
        }}
        onBack={() => { setReport(null); setView({ ...view, screen: 'results' }) }} />
      {report ? <ReportQuestionDialog key={report.target.itemId} target={report.target} questionNumber={report.index + 1}
        continuityToken={continuityToken} onClose={() => setReport(null)}
        onReported={questionId => setReported(previous => ({ ...previous, [questionId]: true }))}
        onRestoreFocus={event => { if (focusFirst(reportReturnFocus.current)) event.preventDefault() }} /> : null}
    </>
  }
  if (view.screen === 'results') {
    const { attempt } = view
    return <ResultsScreen {...identity} courseHref={props.courseHref} attempt={attempt} canStartNew={brief !== null}
      unsentAtDeadline={view.unsent} starting={busy} error={problem}
      onReview={() => setView({ ...view, screen: 'review' })}
      onRetake={() => { if (brief !== null) start('new', null, brief) }}
      onRedo={() => {
        if (brief !== null) start('redo', attempt.id, { questionCount: attempt.questionCount, durationSeconds: brief.durationSeconds })
      }} />
  }
  // The page renders the briefing only when a fresh attempt may start, so a missing brief renders nothing here.
  if (brief === null) return null
  return <IntroScreen {...identity} courseHref={props.courseHref} brief={brief} wholeBank={bankSize <= brief.questionCount}
    briefingVersion={briefingVersion} starting={busy} error={problem} lastResultHref={props.lastResultHref}
    onStart={() => start('new', null, brief)} />
}
