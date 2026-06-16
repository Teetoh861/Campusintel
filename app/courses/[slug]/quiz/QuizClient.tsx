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
  const { questions, sections, timerSeconds, courseSlug } = props

  const [screen, setScreen] = useState<Screen>('intro')
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<AnswersMap>({})
  const [marked, setMarked] = useState<MarkedMap>({})
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('missed')
  const [navOpen, setNavOpen] = useState(false)

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

  const resetAttempt = useCallback(() => {
    setAnswers({})
    setMarked({})
    setCurrent(0)
    setTimeLeft(timerSeconds)
    setReviewFilter('missed')
    setNavOpen(false)
  }, [timerSeconds])

  const start = useCallback(() => {
    resetAttempt()
    setScreen('active')
  }, [resetAttempt])

  const submit = useCallback(() => {
    setNavOpen(false)
    setScreen('results')
  }, [])

  const retake = useCallback(() => {
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
        questionCount={questions.length}
        timerSeconds={timerSeconds}
        sectionCount={sectionStats.length || sections.length}
        onStart={start}
      />
    )
  }

  if (screen === 'active') {
    const q = questions[current]!
    return (
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
        answeredCount={Object.keys(answers).length}
        markedCount={Object.keys(marked).length}
        answersMap={answers}
        markedMap={marked}
        onSelectOption={selectOption}
        onToggleMark={toggleMark}
        onPrev={goPrev}
        onNext={goNext}
        onJump={jumpTo}
        onSubmit={submit}
        onOpenNav={() => setNavOpen(true)}
        onCloseNav={() => setNavOpen(false)}
      />
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
      onRetake={retake}
    />
  )
}
