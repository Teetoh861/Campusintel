// QuizClient — the state machine for the three quiz screens. Owns answers,
// marks, current index, timer and screen. Screen components stay
// presentational; this file is the single source of behaviour.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AnswersMap,
  MarkedMap,
  QuizCoreProps,
  ReviewFilter,
  Screen,
  SectionStat,
} from './types'
import { IntroScreen } from './IntroScreen'
import { QuestionScreen } from './QuestionScreen'
import { ResultsScreen } from './ResultsScreen'
import { sampleQuestionsBySection } from './sampleQuestions'
import { btnAccent, btnBase, btnGhost, btnSm, cx } from '@/components/chrome/ui'

// Timer flips to the red urgency treatment at this threshold (in seconds).
// The pulse keyframe is already wired in quiz.css and respects
// prefers-reduced-motion.
const WARN_THRESHOLD_SECONDS = 5 * 60
const TICK_INTERVAL_MS = 1000

// Sections with at most this many questions get discrete per-question ticks
// in the breakdown; larger sections fall back to a proportional bar. Mirrors
// the comp's quiz.js cutoff so the per-position colour mapping stays honest.
const BREAKDOWN_TICK_LIMIT = 25

export function QuizClient(props: QuizCoreProps) {
  const {
    questions: questionBank,
    sections,
    timerSeconds,
    courseSlug,
    maxQuestions,
  } = props

  const [screen, setScreen] = useState<Screen>('intro')
  const [questions, setQuestions] = useState<QuizCoreProps['questions']>([])
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<AnswersMap>({})
  const [marked, setMarked] = useState<MarkedMap>({})
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('missed')
  const [navOpen, setNavOpen] = useState(false)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)

  // The active screen is distraction-free: campusintel.css/quiz.css hides the
  // global footer when <body data-screen="active">. Sync that to the local
  // state machine for the lifetime of this component.
  useEffect(() => {
    document.body.setAttribute('data-screen', screen)
    return () => {
      document.body.removeAttribute('data-screen')
    }
  }, [screen])

  // Countdown. Runs only on the active screen; functional setState avoids
  // closure traps. Hitting zero auto-submits via the timeLeft effect below.
  useEffect(() => {
    if (screen !== 'active') return
    const id = setInterval(() => {
      setTimeLeft((s) => (s <= 0 ? 0 : s - 1))
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [screen])

  useEffect(() => {
    if (screen === 'active' && timeLeft <= 0) {
      setScreen('results')
    }
  }, [timeLeft, screen])

  // Guard against accidentally losing an in-progress attempt. Only while the
  // quiz is active do we arm the native "leave site?" prompt on refresh, tab
  // close, or navigation away. On intro/results the listener is removed, so
  // leaving those screens never warns. The message text isn't customizable —
  // browsers show their own; preventDefault + returnValue just triggers it.
  useEffect(() => {
    if (screen !== 'active') return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [screen])

  const resetAttempt = useCallback(() => {
    setAnswers({})
    setMarked({})
    setCurrent(0)
    setTimeLeft(timerSeconds)
    setReviewFilter('missed')
    setNavOpen(false)
    setConfirmingSubmit(false)
  }, [timerSeconds])

  const startNewAttempt = useCallback(() => {
    const nextQuestions = sampleQuestionsBySection(
      questionBank,
      sections,
      maxQuestions,
    )
    resetAttempt()
    setQuestions(nextQuestions)
    setScreen('active')
  }, [questionBank, sections, maxQuestions, resetAttempt])

  const submit = useCallback(() => {
    setConfirmingSubmit(false)
    setNavOpen(false)
    setScreen('results')
  }, [])

  // Manual submit is gated behind a confirmation modal to prevent an
  // accidental early submission (V2 spec). The buttons open the modal; the
  // modal's confirm calls the real submit() above. The timer auto-submit does
  // NOT go through here — it transitions straight to results.
  const requestSubmit = useCallback(() => setConfirmingSubmit(true), [])
  const cancelSubmit = useCallback(() => setConfirmingSubmit(false), [])

  const redoAttempt = useCallback(() => {
    resetAttempt()
    setScreen('active')
  }, [resetAttempt])

  const selectOption = useCallback(
    (optIdx: number) => {
      setAnswers((a) => ({ ...a, [current]: optIdx }))
    },
    [current],
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
      const i = sections.indexOf(name)
      return i >= 0 ? String.fromCharCode(65 + i) : '?'
    },
    [sections],
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
    return sections
      .map((name) => byName.get(name))
      .filter((s): s is SectionStat => Boolean(s))
  }, [perQuestion, sections, letterFor])

  if (screen === 'intro') {
    return (
      <IntroScreen
        courseCode={props.courseCode}
        courseTitle={props.courseTitle}
        courseSlug={courseSlug}
        questionCount={Math.min(maxQuestions, questionBank.length)}
        timerSeconds={timerSeconds}
        sectionCount={sectionStats.length || sections.length}
        onStart={startNewAttempt}
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
        />

        {confirmingSubmit ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ci-submit-confirm-title"
          >
            <div
              className="absolute inset-0 bg-ci-navy-900/40"
              onClick={cancelSubmit}
              aria-hidden="true"
            />
            <div className="relative z-[1] w-full max-w-[440px] rounded-[16px] border border-ci-border bg-ci-white p-6 shadow-ci-card">
              <h2
                id="ci-submit-confirm-title"
                className="text-[19px] font-semibold leading-[1.3] tracking-[-0.01em] text-ci-navy-900"
              >
                Submit assessment?
              </h2>
              <p className="mt-3 text-[15px] leading-[1.5] text-ci-gray-600">
                {unanswered > 0
                  ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Are you sure you want to submit?`
                  : 'Are you sure you want to submit?'}
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  className={cx(btnBase, btnSm, btnGhost)}
                  onClick={cancelSubmit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={cx(btnBase, btnSm, btnAccent)}
                  onClick={submit}
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <ResultsScreen
      courseCode={props.courseCode}
      courseSlug={courseSlug}
      questions={questions}
      answers={answers}
      correctCount={correctCount}
      sections={sectionStats}
      tickLimit={BREAKDOWN_TICK_LIMIT}
      reviewFilter={reviewFilter}
      onReviewFilterChange={setReviewFilter}
      onRetakeWithNewQuestions={startNewAttempt}
      onRedoQuestions={redoAttempt}
    />
  )
}
