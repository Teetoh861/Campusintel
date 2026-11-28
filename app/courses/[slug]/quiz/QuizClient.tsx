// QuizClient — the screens around one server-run attempt: the start of a topic's practice (instant feedback), Exam
// mode's start, the resume card, the attempt itself (ActiveAttempt for an exam, InstantAttempt for instant feedback),
// the result and the review. The server owns every attempt; this file only moves between screens.
// A start names a fresh attempt id kept on this device until the server answers, so a lost response is retried with
// the same id and never starts a second attempt. Every attempt has a reloadable URL (?attempt=<id>). Practice in a course
// waits for its open exam: a topic start the database refuses meanwhile offers that exam instead, as the page does
// (the resume card: the exam, its time left and Resume your exam).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postPracticeCommand } from '@/lib/practice/client'
import { ActiveAttempt } from './ActiveAttempt'
import type { ReadingTiming } from './ActiveAttempt'
import { InstantAttempt } from './InstantAttempt'
import { InstantResult } from './InstantResult'
import { IntroScreen } from './IntroScreen'
import { InstantStarting } from './InstantStarting'
import { ReportQuestionDialog } from './ReportQuestionDialog'
import { ScoreOnly } from './ScoreOnly'
import { ResultsScreen } from './ResultsScreen'
import { ResumeScreen } from './ResumeScreen'
import { ReviewScreen } from './ReviewScreen'
import { useReviewAccess } from './useReviewAccess'
import { focusFirst } from './focus-return'
import { canPractiseTopicAgain } from './instant-feedback'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { PRACTICE_COPY, attemptHref, examBriefHref, signInToAttemptHref } from './practice-presentation'
import { clearPendingStart, markResultSeen, readPendingExamStart, readPendingStart, resultSeen, settlePendingStart,
  writePendingStart } from './practice-storage'
import type { GradedAttempt, GradedExam, OpenAttempt, PracticeAttempt, PracticeResult } from '@/lib/practice/contract'
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
  'questions-changed': { title: 'These questions have changed.', body: 'Choose “New questions” instead.' },
  'locked': { title: 'You can’t start a new practice right now.', body: 'Your plan no longer includes this course. Your results are unaffected.' },
  // An instant start whose topic the course no longer has.
  'topic-missing': { title: 'This topic isn’t available.', body: 'Choose another topic.' },
}
// The same two problems when what would not start is an exam: an exam is never called practice.
const EXAM_PROBLEMS: Record<string, Problem> = {
  'start-refused': { title: PRACTICE_COPY.examStartRefusedTitle, body: PRACTICE_COPY.tryAgainBody, retry: true },
  'locked': { title: 'You can’t start a new exam right now.', body: 'Your plan no longer includes this course. Your results are unaffected.' },
}

/** An open exam offered to resume: how far it got and the whole minutes left on the server's deadline. */
type ResumeOffer = { attemptId: string; answered: number; total: number; minutesLeft: number }

export type QuizInitial =
  | { kind: 'intro' }
  // Instant feedback on this topic, started as soon as the page opens (from the Practise by topic page).
  | { kind: 'topic'; topic: string }
  | ({ kind: 'resume' } & ResumeOffer)
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
  /** The copy switch (plans_on_sale) for the score-only result. */
  plansOnSale?: boolean
  /** Campus Bot's Explain is switched on: offered under each finished question. */
  explainAvailable?: boolean
}

export type View =
  // 'intro' is the exam's brief; 'starting' a topic's instant feedback on its way.
  | { screen: 'intro' }
  | { screen: 'starting'; topic: string }
  // The course's open exam: from the page, or from a topic start the database refused while it runs.
  | ({ screen: 'resume' } & ResumeOffer)
  // `received`: when the request that brought the attempt left and its answer arrived, so the exam's clock can use
  // the server's reading at once. Absent for an attempt the page itself rendered.
  | { screen: 'active'; attempt: OpenAttempt; now: string; received?: ReadingTiming }
  | { screen: 'results'; attempt: GradedAttempt; unsent: boolean }
  // Only an exam has a review; a topic's answers were explained as they were picked.
  | { screen: 'review'; attempt: GradedExam; unsent: boolean }

const MS_PER_MINUTE = 60_000

/** The open exam a refused topic start names, offered as the page offers it (whole minutes left, never below zero). */
function resumeOfferFor(attempt: PracticeAttempt, now: string): ResumeOffer {
  const left = Date.parse(attempt.deadlineAt) - Date.parse(now)
  return { attemptId: attempt.id, total: attempt.questionCount, minutesLeft: Math.max(0, Math.floor(left / MS_PER_MINUTE)),
    answered: attempt.status === 'in_progress' ? Object.keys(attempt.saved.answers).length : 0 }
}

function initialView(initial: QuizInitial): View {
  if (initial.kind === 'resume') {
    const { attemptId, answered, total, minutesLeft } = initial
    return { screen: 'resume', attemptId, answered, total, minutesLeft }
  }
  if (initial.kind === 'open') return { screen: 'active', attempt: initial.attempt, now: initial.now }
  if (initial.kind === 'graded') return { screen: 'results', attempt: initial.attempt, unsent: false }
  if (initial.kind === 'topic') return { screen: 'starting', topic: initial.topic }
  return { screen: 'intro' }
}

/** A problem whose way on is a page: sign in and come back, or load this page again for the current sign-in. A start
 * returns to where it began (the exam's brief, or the course's topics); an attempt returns to that attempt. */
function problemFor(status: string, courseHref: string, attemptId: string | null, topic: boolean): Problem | undefined {
  const page = attemptId !== null ? attemptHref(courseHref, attemptId) : topic ? `${courseHref}/practice` : examBriefHref(courseHref)
  if (status === 'signed-out') return { title: PRACTICE_COPY.signedOutTitle, body: PRACTICE_COPY.signedOutBody,
    action: { label: PRACTICE_COPY.signIn, href: attemptId !== null ? signInToAttemptHref(courseHref, attemptId)
      : `${AUTH_PATHS.login}?next=${encodeURIComponent(page)}` } }
  if (status === 'session-changed') return { title: PRACTICE_COPY.sessionChangedTitle, body: '',
    action: { label: PRACTICE_COPY.reload, href: page } }
  return (topic ? undefined : EXAM_PROBLEMS[status]) ?? PROBLEMS[status]
}

export function QuizClient(props: Props): ReactElement | null {
  const { continuityToken, courseSlug, initial } = props
  const [view, setView] = useState<View>(() => initialView(initial))
  const [brief, setBrief] = useState(props.brief)
  const [bankSize, setBankSize] = useState(props.bankSize)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [report, setReport] = useState<{ index: number; target: ReportTarget } | null>(null)
  const [reported, setReported] = useState<Readonly<Record<string, true>>>({})
  const reportReturnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)
  const starting = useRef(false)
  // What Try again sends after a start problem: the same start when unanswered, a new one when refused.
  const retryStart = useRef<PendingStart | null>(null)
  const closeReport = useCallback(() => setReport(null), [])
  const review = useReviewAccess(view, continuityToken, setView, closeReport)

  // Global chrome is hidden only while an attempt is on screen.
  useEffect(() => {
    document.body.setAttribute('data-screen', view.screen)
    return () => { document.body.removeAttribute('data-screen') }
  }, [view.screen])

  const show = useCallback((outcome: Extract<PracticeResult, { attempt: unknown }>, received?: ReadingTiming) => {
    const { attempt } = outcome
    window.history.replaceState(null, '', `${window.location.pathname}?attempt=${attempt.id}`)
    setProblem(null)
    if (attempt.status === 'in_progress') setView({ screen: 'active', attempt, now: outcome.now, received })
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
  // An attempt on screen settles the start kept for it, however it arrived (a resumed topic run included).
  const shownId = 'attempt' in view ? view.attempt.id : null
  useEffect(() => {
    if (shownId !== null) settlePendingStart(courseSlug, shownId)
  }, [courseSlug, shownId])

  const begin = useCallback(async (pending: PendingStart) => {
    if (starting.current) return
    starting.current = true
    setBusy(true)
    setProblem(null)
    writePendingStart(courseSlug, pending)
    let outcome: PracticeResult = { status: 'unavailable' }
    let received: ReadingTiming | undefined
    for (let tries = 0; tries < START_TRIES; tries += 1) {
      const sentAt = performance.now()
      outcome = await postPracticeCommand('mode' in pending
        ? { action: 'start-instant', courseSlug, attemptId: pending.attemptId, topic: pending.topic }
        : { action: 'start', courseSlug, attemptId: pending.attemptId, intent: pending.intent, redoOf: pending.redoOf,
          expected: pending.expected }, continuityToken)
      received = { sentAt, receivedAt: performance.now() }
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
    if (outcome.status === 'ready' || outcome.status === 'in-progress' || outcome.status === 'graded') {
      show(outcome, received)
      return
    }
    // An exam is open in this course: practice waits, and the exam is offered as the page offers it.
    if (outcome.status === 'exam-open') {
      setProblem(null)
      setView({ screen: 'resume', ...resumeOfferFor(outcome.attempt, outcome.now) })
      return
    }
    if (outcome.status === 'policy-changed') {
      setBrief({ questionCount: outcome.questionCount, durationSeconds: outcome.durationSeconds })
      setBankSize(outcome.bankSize)
      setView({ screen: 'intro' })
    }
    const known = 'mode' in pending && outcome.status === 'not-found' ? PROBLEMS['topic-missing']
      : problemFor(outcome.status, props.courseHref, null, 'mode' in pending)
    if (known === undefined) retryStart.current = { ...pending, attemptId: crypto.randomUUID() }
    setProblem(known ?? ('mode' in pending ? PROBLEMS : EXAM_PROBLEMS)['start-refused']!)
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

  // A chosen topic starts straight away, once per mount.
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
      const sentAt = performance.now()
      const outcome = await postPracticeCommand({ action: 'attempt', attemptId: kept.attemptId }, continuityToken)
      const received = { sentAt, receivedAt: performance.now() }
      if (outcome.status === 'ready' || outcome.status === 'graded') { clearPendingStart(courseSlug); show(outcome, received) }
      else if (outcome.status === 'not-found') clearPendingStart(courseSlug)
    })()
  }, [initial, courseSlug, continuityToken, show])

  const resumeId = view.screen === 'resume' ? view.attemptId : null
  const resume = useCallback(async () => {
    if (resumeId === null) return
    setBusy(true)
    setProblem(null)
    const sentAt = performance.now()
    const outcome = await postPracticeCommand({ action: 'attempt', attemptId: resumeId }, continuityToken)
    const received = { sentAt, receivedAt: performance.now() }
    setBusy(false)
    if (outcome.status === 'ready' || outcome.status === 'graded') show(outcome, received)
    else if (outcome.status === 'unavailable') setProblem(PROBLEMS['no-connection']!)
    else setProblem(problemFor(outcome.status, props.courseHref, resumeId, false) ?? PROBLEMS['resume-failed']!)
  }, [resumeId, continuityToken, show, props.courseHref])

  const onGraded = useCallback((attempt: GradedAttempt, unsent: boolean) => {
    setView({ screen: 'results', attempt, unsent })
  }, [])

  const identity = { courseCode: props.courseCode, courseTitle: props.courseTitle, repositoryOnly: props.repositoryOnly }
  // Instant feedback leaves to the course's topic list: the Practise by topic page.
  const topicsHref = `${props.courseHref}/practice`

  if (view.screen === 'active' && view.attempt.mode === 'instant') {
    return <InstantAttempt key={view.attempt.id} {...identity} continuityToken={continuityToken}
      topicsHref={topicsHref} coursePageHref={props.courseHref} attempt={view.attempt} onGraded={attempt => onGraded(attempt, false)}
      explainAvailable={props.explainAvailable === true} />
  }
  if (view.screen === 'active') {
    return <ActiveAttempt key={view.attempt.id} {...identity} continuityToken={continuityToken} courseHref={props.courseHref}
      attempt={view.attempt} serverNow={view.now} received={view.received ?? null} onGraded={onGraded} />
  }
  if (view.screen === 'resume') {
    return <ResumeScreen {...identity} courseHref={props.courseHref} answered={view.answered} total={view.total}
      minutesLeft={view.minutesLeft} opening={busy} error={problem} onContinue={() => { void resume() }}
      onRetry={() => { void resume() }} />
  }
  if (view.screen === 'review') {
    const { attempt } = view
    return <>
      <ReviewScreen {...identity} questions={attempt.questions} correctCount={attempt.result.score} reported={reported}
        reporting={report ? report.index : null}
        explain={props.explainAvailable === true ? { attemptId: attempt.id, continuityToken, courseHref: props.courseHref,
          signInHref: signInToAttemptHref(props.courseHref, attempt.id), reloadHref: attemptHref(props.courseHref, attempt.id) } : null}
        onReport={(index, returnFocusTo) => {
          const question = attempt.questions[index]
          if (!question) return
          reportReturnFocus.current = returnFocusTo
          setReport({ index, target: { courseId: props.repositoryCourseId, itemId: question.itemId,
            revision: question.revision, questionId: question.questionId, attemptId: attempt.id } })
        }}
        // Back to the result as it was: no problem from before the review comes back with it.
        onBack={() => { setReport(null); setProblem(null); setView({ ...view, screen: 'results' }) }} />
      {report ? <ReportQuestionDialog key={report.target.itemId} target={report.target} questionNumber={report.index + 1}
        continuityToken={continuityToken} onClose={() => setReport(null)}
        onReported={questionId => setReported(previous => ({ ...previous, [questionId]: true }))}
        onRestoreFocus={event => { if (focusFirst(reportReturnFocus.current)) event.preventDefault() }} /> : null}
    </>
  }
  if (view.screen === 'results') {
    const { attempt } = view
    const canStartNew = brief !== null && (attempt.canStartNew ?? attempt.reviewAvailable)
    if (!attempt.reviewAvailable) return <ScoreOnly {...identity} attempt={attempt} courseHref={props.courseHref}
      plansOnSale={props.plansOnSale}
      canStartNew={canStartNew} starting={busy} error={problem} onRetry={retry}
      onRetake={() => { if (brief !== null) start('new', null, brief) }} />
    if (attempt.mode === 'instant') {
      const { topic } = attempt
      const next = topic === null ? -1 : props.topics.indexOf(topic) + 1
      const nextTopic = next > 0 ? props.topics[next] ?? null : null
      return <InstantResult {...identity} topicsHref={topicsHref} attempt={attempt}
        canStartNew={canStartNew && canPractiseTopicAgain(topic, props.topics)} nextTopic={canStartNew ? nextTopic : null}
        starting={busy} error={problem} onRetry={retry}
        onPractiseAgain={() => { if (topic !== null) startInstant(topic) }}
        onNextTopic={() => { if (nextTopic !== null) startInstant(nextTopic) }} />
    }
    return <ResultsScreen {...identity} courseHref={props.courseHref} attempt={attempt} canStartNew={canStartNew}
      unsentAtDeadline={view.unsent} starting={busy} openingReview={review.opening} error={review.problem ?? problem}
      onRetry={review.problem !== null ? () => { void review.openReview() } : retry}
      onReview={() => { setProblem(null); void review.openReview() }}
      onRetake={() => { if (brief !== null) start('new', null, brief) }}
      onRedo={() => {
        if (brief !== null) start('redo', attempt.id, { questionCount: attempt.questionCount, durationSeconds: brief.durationSeconds })
      }} />
  }
  // The page renders a start only when a fresh attempt may start, so a missing brief renders nothing here.
  if (brief === null) return null
  if (view.screen === 'starting') {
    return <InstantStarting {...identity} topicsHref={topicsHref} topic={view.topic} error={problem} busy={busy}
      onRetry={retry} />
  }
  return <IntroScreen {...identity} courseHref={props.courseHref} brief={brief} bankSize={bankSize}
    starting={busy} error={problem} onRetry={retry} lastResultHref={props.lastResultHref}
    onStart={() => start('new', null, brief)} />
}
