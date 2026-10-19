// app/courses/[slug]/quiz/ResultsScreen.tsx — This attempt's score, its feedback band, save state and the next actions.
'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Check, Minus, X } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { PRACTICE_COPY, minutesOf, plural, practiceBand, practiceIdentity } from './practice-presentation'
import type { ManagedQuizQuestion } from '@/lib/managed-content/student-projection'
import type { AnswersMap, SaveState } from './types'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  courseHref: string
  repositoryOnly: boolean
  questions: ReadonlyArray<ManagedQuizQuestion>
  answers: AnswersMap
  correctCount: number
  finishReason: 'submitted' | 'timed_out'
  minutesUsed: number
  attemptSeconds: number
  saveState: SaveState
  preparing: boolean
  error: string | null
  onReview: () => void
  onRetakeWithNewQuestions: () => void
  onRedoQuestions: () => void
}

/** Score this attempt only; no cross-attempt history, mastery or section judgement. */
export function ResultsScreen(props: Props): ReactElement {
  const { questions, answers, correctCount, finishReason, saveState, preparing, error } = props
  const total = questions.length
  const unanswered = questions.filter((_, index) => answers[index] === undefined).length
  const incorrect = total - correctCount - unanswered
  const percent = total === 0 ? 0 : Math.round((correctCount / total) * 100)
  const toReview = incorrect + unanswered
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  const timeLine = `${props.minutesUsed} of ${minutesOf(props.attemptSeconds)} minutes used`
  const lede = finishReason === 'timed_out' ? `Submitted automatically when time ran out · ${timeLine}` : `Submitted · ${timeLine}`
  // Results is entered by transition (submit, timeout, back from review); the control that caused it has unmounted,
  // so the screen itself hands focus to its heading exactly once when it mounts.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <StudentPage band={<PageBand title="Practice result" lede={lede} context={<p>{identity.context}</p>} titleRef={heading} />}>
    {finishReason === 'timed_out' ? <div className="mb-6 max-w-[720px]">
      <Notice tone="info" title={PRACTICE_COPY.timedOutTitle}>{PRACTICE_COPY.timedOutBody}</Notice>
    </div> : null}
    {error ? <div className="mb-6 max-w-[720px]"><Notice title={error}>Your next attempt has not started. You can still review this result until you leave the page.</Notice></div> : null}
    {preparing ? <p role="status" className="student-practice-help mb-6">Getting your practice ready. The timer has not started.</p> : null}
    <div className="student-practice-results">
      <section aria-labelledby="student-practice-score-heading">
        <h2 id="student-practice-score-heading" className="sr-only">Score for this attempt</h2>
        <div className="student-practice-score">
          <span className="student-practice-score-pct">{percent}%</span>
          <span className="student-practice-score-of">{correctCount} of {total} correct</span>
        </div>
        <p className="student-practice-band"><b>{practiceBand(percent)}</b><span>{PRACTICE_COPY.bandNote}</span></p>
        <dl className="student-practice-break">
          <div><dt><Check aria-hidden="true" size={16} strokeWidth={2.25} />Correct</dt><dd>{correctCount}</dd></div>
          <div><dt><X aria-hidden="true" size={16} strokeWidth={2.25} />Incorrect</dt><dd>{incorrect}</dd></div>
          <div><dt><Minus aria-hidden="true" size={16} strokeWidth={2.25} />Unanswered</dt><dd>{unanswered}</dd></div>
        </dl>
        {saveState === 'saved' ? <p className="student-practice-meta"><Check aria-hidden="true" size={16} strokeWidth={2.25} />{PRACTICE_COPY.saved}</p> : null}
        {saveState === 'pending' ? <div className="mt-4 max-w-[320px]">
          <StudentLoadingState message={PRACTICE_COPY.saving}><Skeleton className="h-4 w-full" /></StudentLoadingState>
        </div> : null}
        {saveState === 'failed' ? <div className="mt-5 max-w-[720px]">
          <Notice title={PRACTICE_COPY.saveFailedTitle}>{PRACTICE_COPY.saveFailedBody}</Notice>
        </div> : null}
      </section>

      <section className="student-practice-next" aria-labelledby="student-practice-next-heading">
        <h2 id="student-practice-next-heading">{plural(toReview, 'question')} to review</h2>
        <p>See the correct answer for every question in this attempt.</p>
        <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={props.onReview}>Review answers</button>
        <button type="button" className={studentAction(btnGhost)} disabled={preparing} onClick={props.onRetakeWithNewQuestions}>Retake with new questions</button>
        <button type="button" className={studentAction(btnGhost, 'border-transparent')} disabled={preparing} onClick={props.onRedoQuestions}>Redo these questions</button>
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'border-transparent')}>{PRACTICE_COPY.backToCourse}</Link>
        <p className="student-practice-help !mt-0">Retake gives you a fresh set of questions. Redo lets you practise these questions again.</p>
      </section>
    </div>
  </StudentPage>
}
