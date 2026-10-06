// QuizClient — the state machine for the three quiz screens. Owns answers,
// marks, current index, timer and screen. Screen components stay
// presentational; this file is the single source of behaviour.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IntroScreen } from './IntroScreen'
import { QuestionScreen } from './QuestionScreen'
import { ResultsScreen } from './ResultsScreen'
import { sampleQuestionsBySection } from './sampleQuestions'
import { createQuizAttemptRecorder } from './attemptRecording'
import { createAssessmentClock } from './assessmentClock'
import { loadFreshQuiz } from './liveBank'
import { AssessmentConfirmation } from './AssessmentConfirmation'
import type { ReactElement } from 'react'
import type {
  AnswersMap,
  MarkedMap,
  QuizCoreProps,
  ReviewFilter,
  Screen,
  SectionStat,
} from './types'
import type { RecordingStatus } from './attemptRecording'

// Timer flips to the red urgency treatment at this threshold (in seconds).
// The pulse keyframe is already wired in quiz.css and respects
// prefers-reduced-motion.
const WARN_THRESHOLD_SECONDS = 5 * 60
const TICK_INTERVAL_MS = 1000
const HISTORY_GUARD_KEY = '__campusintelQuizGuard'
const BANK_CHANGED_NOTICE = 'The published question bank changed. Review the updated conditions and confirm readiness again.'

// Sections with at most this many questions get discrete per-question ticks
// in the breakdown; larger sections fall back to a proportional bar. Mirrors
// the comp's quiz.js cutoff so the per-position colour mapping stays honest.
const BREAKDOWN_TICK_LIMIT = 25

/** Run the existing quiz screens against the current managed bank and pinned attempt. */
export function QuizClient(props: QuizCoreProps): ReactElement {
  const {
    questions: questionBank,
    sections,
    timerSeconds,
    courseSlug,
    courseContentKey,
    maxQuestions,
  } = props

  const [screen, setScreen] = useState<Screen>('intro')
  const [pendingStartIntent, setPendingStartIntent] = useState<'new' | 'redo'>('new')
  const [briefing, setBriefing] = useState(() => ({
    questionCount: Math.min(maxQuestions, questionBank.length),
    sectionCount: new Set(questionBank.map(question => question.section)).size,
    timerSeconds,
    version: 0,
  }))
  const [questions, setQuestions] = useState<QuizCoreProps['questions']>([])
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<AnswersMap>({})
  const [marked, setMarked] = useState<MarkedMap>({})
  const [attemptDuration, setAttemptDuration] = useState(timerSeconds)
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('missed')
  const [navOpen, setNavOpen] = useState(false)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null)
  const [bankError, setBankError] = useState<string | null>(null)
  const [loadingBank, setLoadingBank] = useState(false)
  const [activeSections, setActiveSections] = useState<ReadonlyArray<string>>(sections)
  const [recorder] = useState(() => createQuizAttemptRecorder(props.continuityToken, setRecordingStatus))
  const [clock] = useState(() => createAssessmentClock())
  const screenRef = useRef<Screen>('intro')
  const startingRef = useRef(false)
  const disarmHistoryGuard = useRef<(restoreEntry?: boolean) => void>(() => {})
  const submitInvoker = useRef<HTMLElement | null>(null)
  const leaveInvoker = useRef<HTMLElement | null>(null)

  const finishAttempt = useCallback((completion: 'submitted' | 'timed_out') => {
    if (screenRef.current !== 'active') return
    screenRef.current = 'results'
    clock.stop()
    recorder.finish(completion)
    disarmHistoryGuard.current()
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
      window.location.replace(`/courses/${encodeURIComponent(courseSlug)}`)
    }

    const handlePopState = () => {
      const shouldLeave = window.confirm(
        'Leave assessment? This local attempt cannot be resumed.',
      )
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
  }, [screen, courseSlug, clock])

  const leaveAssessment = useCallback(() => {
    if (screenRef.current !== 'active') return
    clock.stop()
    disarmHistoryGuard.current(false)
    window.location.replace(`/courses/${encodeURIComponent(courseSlug)}`)
  }, [clock, courseSlug])

  const resetAttempt = useCallback((acceptedDuration: number) => {
    clock.stop()
    setAnswers({})
    setMarked({})
    setCurrent(0)
    setAttemptDuration(acceptedDuration)
    setTimeLeft(acceptedDuration)
    setReviewFilter('missed')
    setNavOpen(false)
    setConfirmingSubmit(false)
    setConfirmingLeave(false)
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
        setBankError('The current question bank is unavailable. Try again.')
        return
      }
      const questionCount = Math.min(fresh.maxQuestions, fresh.questions.length)
      const sectionCount = new Set(fresh.questions.map(question => question.section)).size
      if (questionCount !== briefing.questionCount || sectionCount !== briefing.sectionCount ||
          fresh.timerSeconds !== briefing.timerSeconds) {
        setBriefing(current => ({ questionCount, sectionCount, timerSeconds: fresh.timerSeconds,
          version: current.version + 1 }))
        screenRef.current = 'intro'
        setScreen('intro')
        setBankError(BANK_CHANGED_NOTICE)
        return
      }
      const nextQuestions = sampleQuestionsBySection(fresh.questions, fresh.sections, fresh.maxQuestions)
      setActiveSections(fresh.sections)
      screenRef.current = 'active'
      resetAttempt(fresh.timerSeconds)
      setQuestions(nextQuestions)
      recorder.begin(courseContentKey, nextQuestions)
      setScreen('active')
    })()
  }, [courseSlug, resetAttempt, recorder, courseContentKey, briefing])

  const submit = useCallback(() => {
    const reading = clock.read()
    finishAttempt(reading.secondsLeft === 0 ? 'timed_out' : 'submitted')
  }, [clock, finishAttempt])

  // Manual submit is gated behind a confirmation modal to prevent an
  // accidental early submission (V2 spec). The buttons open the modal; the
  // modal's confirm calls the real submit() above. The timer auto-submit does
  // NOT go through here — it transitions straight to results.
  const requestSubmit = useCallback(() => {
    submitInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmingSubmit(true)
  }, [])
  const requestLeave = useCallback(() => {
    leaveInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmingLeave(true)
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
        setBankError('The current question bank is unavailable. Try again.')
        return
      }
      const currentRevisions = new Map(fresh.questions.map(question =>
        [question.questionId, question.publishedRevision]))
      if (questions.some(question => currentRevisions.get(question.questionId) !== question.publishedRevision)) {
        screenRef.current = 'results'
        setScreen('results')
        setBankError('These questions have changed. Retake with new questions instead.')
        return
      }
      if (fresh.timerSeconds !== briefing.timerSeconds) {
        setBriefing(current => ({
          questionCount: Math.min(fresh.maxQuestions, fresh.questions.length),
          sectionCount: new Set(fresh.questions.map(question => question.section)).size,
          timerSeconds: fresh.timerSeconds,
          version: current.version + 1,
        }))
        screenRef.current = 'intro'
        setScreen('intro')
        setBankError(BANK_CHANGED_NOTICE)
        return
      }
      setActiveSections(fresh.sections)
      screenRef.current = 'active'
      resetAttempt(fresh.timerSeconds)
      recorder.begin(courseContentKey, questions)
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

  // Letter index for each section name, in order of appearance in the bank's
  // sections list. The data only ships names; the comp uses letters (A/B/…)
  // so we mint them from the index — deterministic and stable.
  const letterFor = useCallback(
    (name: string) => {
      const i = activeSections.indexOf(name)
      return i >= 0 ? String.fromCharCode(65 + i) : '?'
    },
    [activeSections],
  )

  // Per-question correctness, computed once from the current answers map.
  // The same source feeds the score, the section breakdown ticks and the
  // review list — so there's exactly one truth.
  const perQuestion = useMemo(
    () =>
      questions.map((q, i) => ({
        qIdx: i,
        ok: answers[i] === q.correctAnswer,
        answered: answers[i] !== undefined,
        section: q.section,
      })),
    [questions, answers],
  )

  const correctCount = useMemo(
    () => perQuestion.reduce((sum, r) => sum + (r.ok ? 1 : 0), 0),
    [perQuestion],
  )

  // Section breakdown. Sections appear in the order the data ships them, and
  // only sections that actually have questions in the attempt slice render.
  // The marks array preserves attempt order, so ticks map to REAL positions
  // — no left-fill of greens followed by reds.
  const sectionStats: ReadonlyArray<SectionStat> = useMemo(() => {
    const byName = new Map<string, SectionStat>()
    for (const r of perQuestion) {
      let stat = byName.get(r.section)
      if (!stat) {
        stat = {
          name: r.section,
          letter: letterFor(r.section),
          total: 0,
          correct: 0,
          marks: [],
        }
        byName.set(r.section, stat)
      }
      // SectionStat.marks is typed readonly; we're still in the build phase.
      const marks = stat.marks as { qIdx: number; ok: boolean }[]
      marks.push({ qIdx: r.qIdx, ok: r.ok })
      stat.total += 1
      if (r.ok) stat.correct += 1
    }
    return activeSections
      .map((name) => byName.get(name))
      .filter((s): s is SectionStat => Boolean(s))
  }, [perQuestion, activeSections, letterFor])

  const recordingNotice = recordingStatus === 'session-changed'
    ? 'Your account or session changed. This attempt could not be saved to history.'
    : recordingStatus === 'unavailable'
    ? 'Attempt history is unavailable. You can still finish and review this quiz.'
    : null
  const bankNotice = bankError ? (
    <p role="alert" className="border-b border-ci-border bg-ci-accent-50 px-6 py-3 text-center text-[13px] font-medium text-ci-navy">
      {bankError}
    </p>
  ) : loadingBank ? (
    <p role="status" className="border-b border-ci-border bg-ci-accent-50 px-6 py-3 text-center text-[13px] font-medium text-ci-navy">
      Loading the latest questions…
    </p>
  ) : null
  const notice = recordingNotice ? (
    <p role="status" className="border-b border-ci-border bg-ci-accent-50 px-6 py-3 text-center text-[13px] font-medium text-ci-navy">
      {recordingNotice}
    </p>
  ) : null

  if (screen === 'intro') {
    return (
      <IntroScreen
        courseCode={props.courseCode}
        courseTitle={props.courseTitle}
        courseSlug={courseSlug}
        questionCount={briefing.questionCount}
        timerSeconds={briefing.timerSeconds}
        sectionCount={briefing.sectionCount}
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
        {notice}
        <QuestionScreen
          question={q}
          current={current}
          total={questions.length}
          sectionLetter={letterFor(q.section)}
          sectionName={q.section}
          selected={answers[current]}
          isMarked={Boolean(marked[current])}
          timeLeft={timeLeft}
          isLowTime={timeLeft <= WARN_THRESHOLD_SECONDS}
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
          onOpenNav={() => setNavOpen(true)}
          onCloseNav={() => setNavOpen(false)}
          onLeave={requestLeave}
        />

        <AssessmentConfirmation kind="submit" open={confirmingSubmit} onOpenChange={setConfirmingSubmit}
          answered={answeredCount} unanswered={unanswered} flagged={Object.keys(marked).length}
          onConfirm={submit} onRestoreFocus={event => {
            if (screenRef.current === 'active' && submitInvoker.current?.isConnected) {
              event.preventDefault()
              submitInvoker.current.focus()
            }
          }} />
        <AssessmentConfirmation kind="leave" open={confirmingLeave} onOpenChange={setConfirmingLeave}
          onConfirm={leaveAssessment} onRestoreFocus={event => {
            if (screenRef.current === 'active' && leaveInvoker.current?.isConnected) {
              event.preventDefault()
              leaveInvoker.current.focus()
            }
          }} />
      </>
    )
  }

  return (
    <>
      {notice}
      {bankNotice}
      <ResultsScreen
        courseCode={props.courseCode}
        courseSlug={courseSlug}
        questions={questions}
        answers={answers}
        correctCount={correctCount}
        sections={sectionStats}
        tickLimit={BREAKDOWN_TICK_LIMIT}
        reviewFilter={reviewFilter}
        preparing={loadingBank}
        onReviewFilterChange={setReviewFilter}
        onRetakeWithNewQuestions={startNewAttempt}
        onRedoQuestions={redoAttempt}
      />
    </>
  )
}
