// QuizClient — the state machine for the Practice screens. Owns answers, marks, current index, timer, save state and
// screen. Screen components stay presentational; this file is the single source of behaviour.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IntroScreen } from './IntroScreen'
import { QuestionScreen } from './QuestionScreen'
import { ResultsScreen } from './ResultsScreen'
import { ReviewScreen } from './ReviewScreen'
import { ReportQuestionDialog } from './ReportQuestionDialog'
import { sampleQuestionsBySection } from './sampleQuestions'
import { createQuizAttemptRecorder } from './attemptRecording'
import { createAssessmentClock } from './assessmentClock'
import { loadFreshQuiz } from './liveBank'
import { AssessmentConfirmation } from './AssessmentConfirmation'
import { focusFirst } from './focus-return'
import { LOW_TIME_SECONDS, PRACTICE_COPY, minutesUsed } from './practice-presentation'
import type { ReactElement } from 'react'
import type { ReturnFocus } from './focus-return'
import type { AnswersMap, MarkedMap, QuizCoreProps, ReportTarget, SaveState, Screen } from './types'
import type { RecordingStatus } from './attemptRecording'

const TICK_INTERVAL_MS = 1000
const HISTORY_GUARD_KEY = '__campusintelQuizGuard'
const BANK_CHANGED_NOTICE = 'The published question bank changed. Review the updated conditions and confirm readiness again.'
const BANK_UNAVAILABLE_NOTICE = 'The current question bank is unavailable. Try again.'
const QUESTIONS_CHANGED_NOTICE = 'These questions have changed. Retake with new questions instead.'
type Completion = 'submitted' | 'timed_out'
type Finish = { reason: Completion; secondsLeft: number }
type Report = { index: number; target: ReportTarget; questionNumber: number }
// Where focus returns when an overlay closes: the invoker first, then the stable control its screen named.
const NO_RETURN_FOCUS: ReturnFocus = []

/** The recorder's status, read as this result's save state; only a confirmed finished row counts as saved. */
function saveStateFrom(status: RecordingStatus | null): SaveState {
  if (status === 'saved') return 'saved'
  if (status === 'signed-out' || status === 'session-changed' || status === 'unavailable' || status === 'content-changed') return 'failed'
  return 'pending'
}

/** Run the existing quiz screens against the current managed bank and pinned attempt. */
export function QuizClient(props: QuizCoreProps): ReactElement {
  const { questions: questionBank, timerSeconds, courseSlug, courseHref, courseContentKey, maxQuestions } = props

  const [screen, setScreen] = useState<Screen>('intro')
  const [pendingStartIntent, setPendingStartIntent] = useState<'new' | 'redo'>('new')
  const [briefing, setBriefing] = useState(() => ({
    questionCount: Math.min(maxQuestions, questionBank.length),
    sectionCount: new Set(questionBank.map(question => question.section)).size,
    bankSize: props.totalInBank,
    timerSeconds,
    version: 0,
  }))
  const [questions, setQuestions] = useState<QuizCoreProps['questions']>([])
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<AnswersMap>({})
  const [marked, setMarked] = useState<MarkedMap>({})
  const [attemptDuration, setAttemptDuration] = useState(timerSeconds)
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [finish, setFinish] = useState<Finish>({ reason: 'submitted', secondsLeft: timerSeconds })
  const [navOpen, setNavOpen] = useState(false)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [reported, setReported] = useState<Readonly<Record<string, true>>>({})
  const [report, setReport] = useState<Report | null>(null)
  const [bankError, setBankError] = useState<string | null>(null)
  const [loadingBank, setLoadingBank] = useState(false)
  const [recorder] = useState(() => createQuizAttemptRecorder(props.continuityToken, setRecordingStatus))
  const [clock] = useState(() => createAssessmentClock())
  const screenRef = useRef<Screen>('intro')
  const startingRef = useRef(false)
  const disarmHistoryGuard = useRef<(restoreEntry?: boolean) => void>(() => {})
  const submitReturnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)
  const leaveReturnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)
  const reportReturnFocus = useRef<ReturnFocus>(NO_RETURN_FOCUS)

  const finishAttempt = useCallback((completion: Completion) => {
    if (screenRef.current !== 'active') return
    screenRef.current = 'results'
    const secondsLeft = completion === 'timed_out' ? 0 : clock.read().secondsLeft
    clock.stop()
    recorder.finish(completion)
    disarmHistoryGuard.current()
    setFinish({ reason: completion, secondsLeft })
    setConfirmingSubmit(false)
    setConfirmingLeave(false)
    setNavOpen(false)
    setScreen('results')
  }, [clock, recorder])

  // Global chrome is hidden only while the active assessment is mounted.
  useEffect(() => {
    document.body.setAttribute('data-screen', screen)
    return () => {
      document.body.removeAttribute('data-screen')
    }
  }, [screen])

  // Sample a deadline, including when a suspended tab resumes. Callback count
  // cannot extend the assessment. The screen transition makes expiry one-shot.
  useEffect(() => {
    if (screen !== 'active') return
    clock.start(attemptDuration)
    const update = () => {
      const reading = clock.read()
      setTimeLeft(reading.secondsLeft)
      if (reading.expiredNow) finishAttempt('timed_out')
    }
    const whenVisible = () => { if (document.visibilityState === 'visible') update() }
    update()
    const id = setInterval(update, TICK_INTERVAL_MS)
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    return () => {
      clearInterval(id)
      clock.stop()
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
    }
  }, [screen, clock, finishAttempt, attemptDuration])

  useEffect(() => {
    if (recordingStatus !== 'content-changed' || screenRef.current !== 'active') return
    screenRef.current = 'intro'
    clock.stop()
    disarmHistoryGuard.current()
    setScreen('intro')
    setBankError('The question bank changed while this attempt was starting. Try again.')
  }, [recordingStatus, clock])

  // Guard against accidentally losing an in-progress attempt. Only while the
  // quiz is active do we arm refresh/close and client-side Back protection.
  useEffect(() => {
    if (screen !== 'active') return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    const sentinelState = {
      ...(window.history.state ?? {}),
      [HISTORY_GUARD_KEY]: true,
    }
    if (!window.history.state?.[HISTORY_GUARD_KEY]) {
      window.history.pushState(sentinelState, '', window.location.href)
    }

    const removeListeners = () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }

    const leaveForCourse = () => {
      removeListeners()
      disarmHistoryGuard.current = () => {}
      clock.stop()
      window.location.replace(courseHref)
    }

    const handlePopState = () => {
      const shouldLeave = window.confirm(`${PRACTICE_COPY.leaveTitle} ${PRACTICE_COPY.leaveBody}`)
      if (shouldLeave) {
        leaveForCourse()
        return
      }
      window.history.pushState(sentinelState, '', window.location.href)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)

    disarmHistoryGuard.current = (restoreEntry = true) => {
      removeListeners()
      disarmHistoryGuard.current = () => {}
      if (restoreEntry && window.history.state?.[HISTORY_GUARD_KEY]) {
        window.history.back()
      }
    }

    return () => {
      removeListeners()
      disarmHistoryGuard.current = () => {}
    }
  }, [screen, courseHref, clock])

  const leaveAssessment = useCallback(() => {
    if (screenRef.current !== 'active') return
    clock.stop()
    disarmHistoryGuard.current(false)
    window.location.replace(courseHref)
  }, [clock, courseHref])

  const resetAttempt = useCallback((acceptedDuration: number) => {
    clock.stop()
    setAnswers({})
    setMarked({})
    setCurrent(0)
    setAttemptDuration(acceptedDuration)
    setTimeLeft(acceptedDuration)
    setNavOpen(false)
    setConfirmingSubmit(false)
    setConfirmingLeave(false)
    setReport(null)
    setReported({})
  }, [clock])

  const startNewAttempt = useCallback(() => {
    if (screenRef.current === 'active' || startingRef.current) return
    setPendingStartIntent('new')
    startingRef.current = true
    setLoadingBank(true)
    setBankError(null)
    void (async () => {
      const fresh = await loadFreshQuiz(courseSlug)
      startingRef.current = false
      setLoadingBank(false)
      if (!fresh || screenRef.current === 'active') {
        setBankError(BANK_UNAVAILABLE_NOTICE)
        return
      }
      const questionCount = Math.min(fresh.maxQuestions, fresh.questions.length)
      const sectionCount = new Set(fresh.questions.map(question => question.section)).size
      if (questionCount !== briefing.questionCount || sectionCount !== briefing.sectionCount ||
          fresh.timerSeconds !== briefing.timerSeconds) {
        setBriefing(current => ({ questionCount, sectionCount, bankSize: fresh.bankSize,
          timerSeconds: fresh.timerSeconds, version: current.version + 1 }))
        screenRef.current = 'intro'
        setScreen('intro')
        setBankError(BANK_CHANGED_NOTICE)
        return
      }
      const nextQuestions = sampleQuestionsBySection(fresh.questions, fresh.sections, fresh.maxQuestions)
      screenRef.current = 'active'
      resetAttempt(fresh.timerSeconds)
      setQuestions(nextQuestions)
      setAttemptId(recorder.begin(courseContentKey, nextQuestions))
      setScreen('active')
    })()
  }, [courseSlug, resetAttempt, recorder, courseContentKey, briefing])

  const submit = useCallback(() => {
    const reading = clock.read()
    finishAttempt(reading.secondsLeft === 0 ? 'timed_out' : 'submitted')
  }, [clock, finishAttempt])

  // Manual submit is gated behind a confirmation to prevent an accidental early
  // submission. The buttons open the confirmation; its confirm calls the real
  // submit() above. The timer auto-submit does NOT go through here.
  const requestSubmit = useCallback((returnFocusTo: ReturnFocus = NO_RETURN_FOCUS) => {
    submitReturnFocus.current = returnFocusTo
    setConfirmingSubmit(true)
  }, [])
  const requestLeave = useCallback((returnFocusTo: ReturnFocus = NO_RETURN_FOCUS) => {
    leaveReturnFocus.current = returnFocusTo
    setConfirmingLeave(true)
  }, [])
  // One restore rule for every practice overlay: the first named control that still accepts focus wins. Once the
  // overlay's screen has left, the next screen owns its own entry focus and the primitive must not reach back.
  const restoreFocus = useCallback((event: Event, screen: Screen, targets: ReturnFocus) => {
    if (screenRef.current !== screen || focusFirst(targets)) event.preventDefault()
  }, [])

  const redoAttempt = useCallback(() => {
    const canRedo = screenRef.current === 'results' ||
      (screenRef.current === 'intro' && pendingStartIntent === 'redo')
    if (!canRedo || startingRef.current) return
    setPendingStartIntent('redo')
    startingRef.current = true
    setLoadingBank(true)
    setBankError(null)
    void (async () => {
      const fresh = await loadFreshQuiz(courseSlug)
      startingRef.current = false
      setLoadingBank(false)
      if (!fresh) {
        setBankError(BANK_UNAVAILABLE_NOTICE)
        return
      }
      const currentRevisions = new Map(fresh.questions.map(question =>
        [question.questionId, question.publishedRevision]))
      if (questions.some(question => currentRevisions.get(question.questionId) !== question.publishedRevision)) {
        screenRef.current = 'results'
        setScreen('results')
        setBankError(QUESTIONS_CHANGED_NOTICE)
        return
      }
      if (fresh.timerSeconds !== briefing.timerSeconds) {
        setBriefing(current => ({
          questionCount: Math.min(fresh.maxQuestions, fresh.questions.length),
          sectionCount: new Set(fresh.questions.map(question => question.section)).size,
          bankSize: fresh.bankSize,
          timerSeconds: fresh.timerSeconds,
          version: current.version + 1,
        }))
        screenRef.current = 'intro'
        setScreen('intro')
        setBankError(BANK_CHANGED_NOTICE)
        return
      }
      screenRef.current = 'active'
      resetAttempt(fresh.timerSeconds)
      setAttemptId(recorder.begin(courseContentKey, questions))
      setScreen('active')
    })()
  }, [courseSlug, resetAttempt, recorder, courseContentKey, questions, briefing.timerSeconds, pendingStartIntent])

  const selectOption = useCallback(
    (optIdx: number) => {
      if (screenRef.current !== 'active') return
      if (clock.read().secondsLeft === 0) {
        finishAttempt('timed_out')
        return
      }
      recorder.select(current, optIdx)
      setAnswers((a) => ({ ...a, [current]: optIdx }))
    },
    [current, recorder, clock, finishAttempt],
  )

  const toggleMark = useCallback(() => {
    setMarked((m) => {
      const next = { ...m }
      if (next[current]) delete next[current]
      else next[current] = true
      return next
    })
  }, [current])

  const goPrev = useCallback(() => {
    setCurrent((c) => (c > 0 ? c - 1 : c))
  }, [])

  const goNext = useCallback(() => {
    setCurrent((c) => (c < questions.length - 1 ? c + 1 : c))
  }, [questions.length])

  const jumpTo = useCallback((idx: number) => {
    setCurrent(idx)
    setNavOpen(false)
  }, [])

  const openNav = useCallback(() => setNavOpen(true), [])
  const closeNav = useCallback(() => setNavOpen(false), [])

  const openReview = useCallback(() => {
    if (screenRef.current !== 'results') return
    screenRef.current = 'review'
    setScreen('review')
  }, [])

  const backToResults = useCallback(() => {
    if (screenRef.current !== 'review') return
    setReport(null)
    screenRef.current = 'results'
    setScreen('results')
  }, [])

  // The report names the exact item and revision this attempt showed; the attempt id only once that attempt is saved.
  const openReport = useCallback((index: number, returnFocusTo: ReturnFocus = NO_RETURN_FOCUS) => {
    const question = questions[index]
    if (!question) return
    reportReturnFocus.current = returnFocusTo
    setReport({ index, questionNumber: index + 1, target: {
      courseId: props.repositoryCourseId, itemId: question.itemId, revision: question.publishedRevision,
      questionId: question.questionId, attemptId: recordingStatus === 'saved' ? attemptId : null,
    } })
  }, [questions, props.repositoryCourseId, recordingStatus, attemptId])

  const markReported = useCallback((questionId: string) => {
    setReported(previous => ({ ...previous, [questionId]: true }))
  }, [])

  // Per-question correctness, computed once from the current answers map; score and review share it.
  const correctCount = useMemo(
    () => questions.reduce((sum, question, index) => sum + (answers[index] === question.correctAnswer ? 1 : 0), 0),
    [questions, answers],
  )

  const identity = { courseCode: props.courseCode, courseTitle: props.courseTitle, repositoryOnly: props.repositoryOnly }

  if (screen === 'intro') {
    return (
      <IntroScreen
        {...identity}
        courseHref={courseHref}
        questionCount={briefing.questionCount}
        bankSize={briefing.bankSize}
        timerSeconds={briefing.timerSeconds}
        briefingVersion={briefing.version}
        preparing={loadingBank}
        error={bankError}
        onStart={pendingStartIntent === 'redo' ? redoAttempt : startNewAttempt}
      />
    )
  }

  if (screen === 'active') {
    const q = questions[current]!
    const answeredCount = Object.keys(answers).length
    const unanswered = questions.length - answeredCount
    return (
      <>
        <QuestionScreen
          {...identity}
          question={q}
          current={current}
          total={questions.length}
          selected={answers[current]}
          isMarked={Boolean(marked[current])}
          timeLeft={timeLeft}
          isLowTime={timeLeft <= LOW_TIME_SECONDS}
          navOpen={navOpen}
          answeredCount={answeredCount}
          markedCount={Object.keys(marked).length}
          answersMap={answers}
          markedMap={marked}
          onSelectOption={selectOption}
          onToggleMark={toggleMark}
          onPrev={goPrev}
          onNext={goNext}
          onJump={jumpTo}
          onSubmit={requestSubmit}
          onOpenNav={openNav}
          onCloseNav={closeNav}
          onLeave={requestLeave}
        />

        <AssessmentConfirmation kind="submit" open={confirmingSubmit} onOpenChange={setConfirmingSubmit}
          answered={answeredCount} unanswered={unanswered} flagged={Object.keys(marked).length}
          onConfirm={submit} onRestoreFocus={event => restoreFocus(event, 'active', submitReturnFocus.current)} />
        <AssessmentConfirmation kind="leave" open={confirmingLeave} onOpenChange={setConfirmingLeave}
          onConfirm={leaveAssessment} onRestoreFocus={event => restoreFocus(event, 'active', leaveReturnFocus.current)} />
      </>
    )
  }

  if (screen === 'review') {
    return (
      <>
        <ReviewScreen
          {...identity}
          questions={questions}
          answers={answers}
          correctCount={correctCount}
          reported={reported}
          reporting={report ? report.index : null}
          onReport={openReport}
          onBack={backToResults}
        />
        {report ? <ReportQuestionDialog key={report.target.itemId} target={report.target} questionNumber={report.questionNumber}
          continuityToken={props.continuityToken} onClose={() => setReport(null)} onReported={markReported}
          onRestoreFocus={event => restoreFocus(event, 'review', reportReturnFocus.current)} /> : null}
      </>
    )
  }

  return (
    <ResultsScreen
      {...identity}
      courseHref={courseHref}
      questions={questions}
      answers={answers}
      correctCount={correctCount}
      finishReason={finish.reason}
      minutesUsed={minutesUsed(attemptDuration, finish.secondsLeft)}
      attemptSeconds={attemptDuration}
      saveState={saveStateFrom(recordingStatus)}
      preparing={loadingBank}
      error={bankError}
      onReview={openReview}
      onRetakeWithNewQuestions={startNewAttempt}
      onRedoQuestions={redoAttempt}
    />
  )
}
