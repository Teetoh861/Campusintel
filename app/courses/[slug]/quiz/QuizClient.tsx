// QuizClient — the Practice screens around one server-run attempt: the start of a topic's instant feedback, the exam
// briefing, the resume card, the attempt itself (ActiveAttempt for an exam, InstantAttempt for instant feedback), the
// result and the review. The server owns every attempt; this file only moves between screens.
// A start names a fresh attempt id kept on this device until the server answers, so a lost response is retried with
// the same id and never starts a second attempt. Every attempt has a reloadable URL (?attempt=<id>).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postPracticeCommand } from '@/lib/practice/client'
import { ActiveAttempt } from './ActiveAttempt'
import { InstantAttempt } from './InstantAttempt'
import { InstantResult } from './InstantResult'
import { IntroScreen } from './IntroScreen'
import { InstantStarting } from './InstantStarting'
import { ReportQuestionDialog } from './ReportQuestionDialog'
import { ResultsScreen } from './ResultsScreen'
import { ResumeScreen } from './ResumeScreen'
import { ReviewScreen } from './ReviewScreen'
import { focusFirst } from './focus-return'
import { PRACTICE_COPY, attemptHref } from './practice-presentation'
import { clearPendingStart, markResultSeen, readPendingExamStart, readPendingStart, resultSeen, writePendingStart } from './practice-storage'
import type { GradedAttempt, GradedExam, OpenAttempt, PracticeResult } from '@/lib/practice/contract'
import type { ReturnFocus } from './focus-return'
import type { PendingStart } from './practice-storage'
import type { PracticeProblem } from './practice-presentation'
import type { PracticeBrief, ReportTarget } from './types'
import type { ReactElement } from 'react'

const START_TRIES = 3
const START_RETRY_MS = 1500
const NO_RETURN_FOCUS: ReturnFocus = []
type Problem = PracticeProblem
const PROBLEMS: Record<string, Problem> = {
  // No answer from the server: Try again repeats the same request, so it can only find or make this one attempt.
  'no-connection': { title: PRACTICE_COPY.noConnectionTitle, body: PRACTICE_COPY.noConnectionBody, retry: true },
  // The server answered and started nothing.
  'start-refused': { title: PRACTICE_COPY.startRefusedTitle, body: PRACTICE_COPY.tryAgainBody, retry: true },
  'resume-failed': { title: PRACTICE_COPY.resumeFailedTitle, body: PRACTICE_COPY.tryAgainBody, retry: true },
  'policy-changed': { title: PRACTICE_COPY.changedTitle, body: PRACTICE_COPY.changedBody },
  'questions-changed': { title: 'These questions have changed.', body: 'Retake with new questions instead.' },
  'locked': { title: 'You can’t start a new attempt right now.', body: 'Your plan no longer includes this course. Your results are unaffected.' },
  'signed-out': { title: PRACTICE_COPY.signedOutTitle, body: PRACTICE_COPY.signedOutBody },
  'session-changed': { title: 'You signed in on another tab.', body: 'Refresh this page to continue.' },
  // An instant start whose topic the course no longer has.
  'topic-missing': { title: 'This topic isn’t available.', body: 'Choose another topic from the course page.' },
}

export type QuizInitial =
  | { kind: 'intro' }
  // Instant feedback on this topic, started as soon as the page opens (from the course's topic list).
  | { kind: 'topic'; topic: string }
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
  // The course's topics in order, for Next topic at the end of an instant attempt.
  topics: ReadonlyArray<string>
  lastResultHref: string | null
  initial: QuizInitial
}

type View =
  // 'intro' is the exam's brief; 'starting' a topic's instant feedback on its way.
  | { screen: 'intro' }
  | { screen: 'starting'; topic: string }
  | { screen: 'resume' }
  | { screen: 'active'; attempt: OpenAttempt; now: string }
  | { screen: 'results'; attempt: GradedAttempt; unsent: boolean }
  // Only an exam has a review; a topic's answers were explained as they were picked.
  | { screen: 'review'; attempt: GradedExam; unsent: boolean }

function initialView(initial: QuizInitial): View {
  if (initial.kind === 'resume') return { screen: 'resume' }
  if (initial.kind === 'open') return { screen: 'active', attempt: initial.attempt, now: initial.now }
  if (initial.kind === 'graded') return { screen: 'results', attempt: initial.attempt, unsent: false }
  if (initial.kind === 'topic') return { screen: 'starting', topic: initial.topic }
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
  // What Try again sends after a start problem: the same start when unanswered, a new one when refused.
  const retryStart = useRef<PendingStart | null>(null)

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
      outcome = await postPracticeCommand('mode' in pending
        ? { action: 'start-instant', courseSlug, attemptId: pending.attemptId, topic: pending.topic }
        : { action: 'start', courseSlug, attemptId: pending.attemptId, intent: pending.intent, redoOf: pending.redoOf,
          expected: pending.expected }, continuityToken)
      if (outcome.status !== 'unavailable') break
      await new Promise(resolve => setTimeout(resolve, START_RETRY_MS * (tries + 1)))
    }
    starting.current = false
    setBusy(false)
    // Unanswered: the same attempt id is kept, so trying again (or reloading) can only find this start, never a second.
    // Once reconnected, the server returns that attempt with its real deadline if it started, or starts it now.
    if (outcome.status === 'unavailable') {
      retryStart.current = pending
      setProblem(PROBLEMS['no-connection']!)
      return
    }
    retryStart.current = null
    clearPendingStart(courseSlug)
    if (outcome.status === 'ready' || outcome.status === 'in-progress' || outcome.status === 'graded') { show(outcome); return }
    // An exam is open in this course: practice waits, and the exam is one tap away.
    if (outcome.status === 'exam-open') {
      setProblem({ title: PRACTICE_COPY.examOpenTitle, body: PRACTICE_COPY.examOpenBody,
        action: { label: PRACTICE_COPY.resumeExam, href: attemptHref(props.courseHref, outcome.attempt.id) } })
      return
    }
    if (outcome.status === 'policy-changed') {
      setBrief({ questionCount: outcome.questionCount, durationSeconds: outcome.durationSeconds })
      setBankSize(outcome.bankSize)
      setBriefingVersion(version => version + 1)
      setView({ screen: 'intro' })
    }
    const known = 'mode' in pending && outcome.status === 'not-found' ? PROBLEMS['topic-missing'] : PROBLEMS[outcome.status]
    if (known === undefined) retryStart.current = { ...pending, attemptId: crypto.randomUUID() }
    setProblem(known ?? PROBLEMS['start-refused']!)
  }, [courseSlug, continuityToken, show, props.courseHref])

  const retry = useCallback(() => {
    const next = retryStart.current
    if (next !== null) void begin(next)
  }, [begin])

  const start = useCallback((intent: 'new' | 'redo', redoOf: string | null, expected: PracticeBrief) => {
    const kept = readPendingStart(courseSlug)
    const same = kept !== null && !('mode' in kept) && kept.intent === intent && kept.redoOf === redoOf
    void begin(same ? kept : { attemptId: crypto.randomUUID(), intent, redoOf,
      expected: { ...expected, wholeBank: bankSize <= expected.questionCount } })
  }, [courseSlug, begin, bankSize])

  // Instant feedback has no brief: a start of this topic kept from a lost response is retried with its own attempt id.
  const startInstant = useCallback((topic: string) => {
    const kept = readPendingStart(courseSlug)
    void begin(kept !== null && 'mode' in kept && kept.topic === topic ? kept
      : { attemptId: crypto.randomUUID(), mode: 'instant', topic })
  }, [courseSlug, begin])

  // A topic chosen on the course page starts straight away, once per mount.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (initial.kind !== 'topic' || autoStarted.current) return
    autoStarted.current = true
    startInstant(initial.topic)
  }, [initial, startInstant])

  // A start whose response was lost before a reload: ask for that same attempt instead of offering a new one.
  useEffect(() => {
    if (initial.kind !== 'intro' && !(initial.kind === 'graded' && initial.latest)) return
    // Exam mode (its brief, or its last result) keeps to exam starts; a lost topic start never replaces the brief.
    const examEntry = initial.kind === 'intro' || initial.attempt.mode === 'exam'
    const kept = examEntry ? readPendingExamStart(courseSlug) : readPendingStart(courseSlug)
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
    else if (outcome.status === 'unavailable') setProblem(PROBLEMS['no-connection']!)
    else setProblem(PROBLEMS[outcome.status] ?? PROBLEMS['resume-failed']!)
  }, [initial, continuityToken, show])

  const onGraded = useCallback((attempt: GradedAttempt, unsent: boolean) => {
    setView({ screen: 'results', attempt, unsent })
  }, [])

  const identity = { courseCode: props.courseCode, courseTitle: props.courseTitle, repositoryOnly: props.repositoryOnly }
  // Instant feedback leaves to the course's topic list.
  const topicsHref = `${props.courseHref}#cbtPractice`

  if (view.screen === 'active' && view.attempt.mode === 'instant') {
    return <InstantAttempt key={view.attempt.id} {...identity} continuityToken={continuityToken}
      courseHref={topicsHref} attempt={view.attempt} onGraded={attempt => onGraded(attempt, false)} />
  }
  if (view.screen === 'active') {
    return <ActiveAttempt key={view.attempt.id} {...identity} continuityToken={continuityToken} courseHref={props.courseHref}
      attempt={view.attempt} serverNow={view.now} onGraded={onGraded} />
  }
  if (view.screen === 'resume' && initial.kind === 'resume') {
    return <ResumeScreen {...identity} courseHref={props.courseHref} answered={initial.answered} total={initial.total}
      minutesLeft={initial.minutesLeft} opening={busy} error={problem} onContinue={() => { void resume() }}
      onRetry={() => { void resume() }} />
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
    if (attempt.mode === 'instant') {
      const { topic } = attempt
      const next = topic === null ? -1 : props.topics.indexOf(topic) + 1
      const nextTopic = next > 0 ? props.topics[next] ?? null : null
      return <InstantResult {...identity} courseHref={topicsHref} attempt={attempt}
        canStartNew={brief !== null && topic !== null} nextTopic={brief !== null ? nextTopic : null}
        starting={busy} error={problem} onRetry={retry}
        onPractiseAgain={() => { if (topic !== null) startInstant(topic) }}
        onNextTopic={() => { if (nextTopic !== null) startInstant(nextTopic) }} />
    }
    return <ResultsScreen {...identity} courseHref={props.courseHref} attempt={attempt} canStartNew={brief !== null}
      unsentAtDeadline={view.unsent} starting={busy} error={problem} onRetry={retry}
      onReview={() => setView({ screen: 'review', attempt, unsent: view.unsent })}
      onRetake={() => { if (brief !== null) start('new', null, brief) }}
      onRedo={() => {
        if (brief !== null) start('redo', attempt.id, { questionCount: attempt.questionCount, durationSeconds: brief.durationSeconds })
      }} />
  }
  // The page renders a start only when a fresh attempt may start, so a missing brief renders nothing here.
  if (brief === null) return null
  if (view.screen === 'starting') {
    return <InstantStarting {...identity} courseHref={topicsHref} topic={view.topic} error={problem} busy={busy}
      onRetry={retry} />
  }
  return <IntroScreen {...identity} courseHref={props.courseHref} brief={brief} wholeBank={bankSize <= brief.questionCount}
    briefingVersion={briefingVersion} starting={busy} error={problem} onRetry={retry} lastResultHref={props.lastResultHref}
    onStart={() => start('new', null, brief)} />
}
