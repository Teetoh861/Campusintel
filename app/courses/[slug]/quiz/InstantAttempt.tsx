'use client'
// app/courses/[slug]/quiz/InstantAttempt.tsx — One open instant-feedback attempt. A pick is sent to the server, which
// records and locks it and only then returns that question's correct option and explanation; the next question waits
// for that result. A pick the server has not answered (offline, signed out) shows as locked, is kept on this device and
// is sent again on reconnect or reload: the server answers a repeated pick with the result it already recorded.
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CircleCheck, CircleX, Lock } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postPracticeCommand } from '@/lib/practice/client'
import { INSTANT_COPY, browserHapticEnv, firstOpenQuestion, optionMarkOf, vibrateForResult } from './instant-feedback'
import { optionLetter, practiceIdentity } from './practice-presentation'
import { clearPendingPick, readPendingPick, writePendingPick } from './practice-storage'
import type { GradedAttempt, OpenAttempt, PickFeedback } from '@/lib/practice/contract'
import type { PendingPick } from './practice-storage'
import type { ReactElement } from 'react'

type Props = {
  continuityToken: string
  courseCode: string
  courseTitle: string
  repositoryOnly: boolean
  courseHref: string
  attempt: OpenAttempt
  onGraded: (attempt: GradedAttempt) => void
}

// What the line under the options says while a pick has no result.
type Waiting = 'sending' | 'offline' | 'signed-out' | 'refused' | null
const REFUSED: Record<string, string> = {
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'not-found': 'This attempt is no longer available.',
}
const RETRY = 'Something went wrong. Try again.'

function feedbackOf(attempt: OpenAttempt): Record<string, PickFeedback> {
  return Object.fromEntries(attempt.questions.flatMap(question =>
    question.feedback === undefined ? [] : [[question.questionId, question.feedback]]))
}

export function InstantAttempt(props: Props): ReactElement {
  const { attempt, continuityToken, onGraded } = props
  const { questions } = attempt
  const id = useId()
  const [current, setCurrent] = useState(() => firstOpenQuestion(questions))
  const [feedback, setFeedback] = useState<Record<string, PickFeedback>>(() => feedbackOf(attempt))
  const [pending, setPending] = useState<PendingPick | null>(null)
  const [waiting, setWaiting] = useState<Waiting>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [graded, setGraded] = useState<GradedAttempt | null>(null)
  const sending = useRef(false)
  // Haptics follow a tap on this page only: a pick resent by a reload does not vibrate.
  const tapped = useRef(false)
  const prompt = useRef<HTMLParagraphElement>(null)
  // The parent's callback may change every render; the pick sender and the reload resend must not.
  const gradedTo = useRef(onGraded)
  useEffect(() => { gradedTo.current = onGraded }, [onGraded])
  const question = questions[current]!
  const shown = feedback[question.questionId]
  const isLast = current === questions.length - 1
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)

  const send = useCallback(async (pick: PendingPick) => {
    if (sending.current) return
    sending.current = true
    setWaiting('sending')
    const outcome = await postPracticeCommand({ action: 'pick', attemptId: attempt.id, ...pick }, continuityToken)
    sending.current = false
    if (outcome.status === 'picked' || outcome.status === 'answer-locked') {
      clearPendingPick(attempt.id)
      setPending(null)
      setWaiting(null)
      const result = outcome.pick
      setFeedback(previous => ({ ...previous, ...(outcome.attempt.status === 'in_progress' ? feedbackOf(outcome.attempt) : {}),
        [result.questionId]: { selected: result.selected, correctOption: result.correctOption,
          explanation: result.explanation } }))
      if (outcome.attempt.status !== 'in_progress') setGraded(outcome.attempt)
      if (outcome.status === 'picked') vibrateForResult(result.isCorrect, browserHapticEnv(tapped.current))
      return
    }
    if (outcome.status === 'graded' && outcome.attempt.status !== 'in_progress') {
      // The attempt closed before this pick reached it: nothing more is recorded; the result stands.
      clearPendingPick(attempt.id)
      gradedTo.current(outcome.attempt)
      return
    }
    if (outcome.status === 'unavailable') { setWaiting('offline'); return }
    if (outcome.status === 'signed-out') { setWaiting('signed-out'); return }
    clearPendingPick(attempt.id)
    setPending(null)
    setWaiting('refused')
    setRefusal(REFUSED[outcome.status] ?? RETRY)
  }, [attempt.id, continuityToken])

  // A pick kept from before a reload is sent again; one the server already answered (another tab) is dropped.
  useEffect(() => {
    const kept = readPendingPick(attempt.id)
    if (kept === null) return
    if (!attempt.questions.some(entry => entry.questionId === kept.questionId && entry.feedback === undefined)) {
      clearPendingPick(attempt.id)
      return
    }
    setPending(kept)
    setCurrent(Math.max(0, attempt.questions.findIndex(entry => entry.questionId === kept.questionId)))
    void send(kept)
  }, [attempt.id, attempt.questions, send])

  useEffect(() => {
    if (pending === null) return
    const resend = () => { void send(pending) }
    window.addEventListener('online', resend)
    return () => window.removeEventListener('online', resend)
  }, [pending, send])

  const choose = (option: number) => {
    if (shown !== undefined || pending !== null) return
    tapped.current = true
    const pick = { questionId: question.questionId, option }
    writePendingPick(attempt.id, pick)
    setPending(pick)
    setRefusal(null)
    void send(pick)
  }

  const next = () => {
    if (shown === undefined) return
    if (graded !== null && (isLast || questions.every(entry => feedback[entry.questionId] !== undefined))) {
      gradedTo.current(graded)
      return
    }
    setCurrent(index => Math.min(questions.length - 1, index + 1))
    requestAnimationFrame(() => prompt.current?.focus())
  }

  const lockedOption = pending?.questionId === question.questionId ? pending.option : null
  const promptId = `${id}-prompt`
  const statusText = waiting === 'sending' ? INSTANT_COPY.checking : waiting === 'offline' ? INSTANT_COPY.offline
    : waiting === 'signed-out' ? INSTANT_COPY.signedOut : waiting === 'refused' ? refusal : null
  const announcement = shown === undefined ? '' : shown.selected === shown.correctOption ? `${INSTANT_COPY.correct}.`
    : `Incorrect. ${INSTANT_COPY.correctAnswer}: ${optionLetter(shown.correctOption)}.`

  return <div className="student-instant">
    <div className="student-practice-bar">
      <div className="student-workspace student-instant-bar">
        <Link href={props.courseHref} prefetch={false} className={studentAction(btnGhost, 'border-transparent px-3')}>
          {INSTANT_COPY.exit}
        </Link>
        <p className="student-instant-position" aria-label={`Question ${current + 1} of ${questions.length}`}>
          {current + 1} of {questions.length}
        </p>
      </div>
    </div>

    <div className="student-workspace student-instant-main">
      <h1 className="sr-only">{identity.heading}</h1>
      <p ref={prompt} tabIndex={-1} className="student-practice-prompt student-instant-prompt" id={promptId}>{question.prompt}</p>
      <fieldset className="student-instant-options" aria-labelledby={promptId}>
        <legend className="sr-only">Choose one answer</legend>
        {question.options.map((text, index) => {
          const mark = optionMarkOf(index, shown)
          const locked = lockedOption === index
          return <label key={`${question.questionId}-${index}`} className="student-practice-option student-instant-option"
            data-mark={mark?.mark} data-locked={locked ? 'true' : undefined}>
            <input className="sr-only" type="radio" name={`${id}-${question.questionId}`} value={index}
              checked={shown?.selected === index || locked} disabled={shown !== undefined || pending !== null}
              onChange={() => choose(index)} />
            <span className="student-practice-option-mark" aria-hidden="true">{optionLetter(index)}</span>
            <span className="student-practice-option-text">{text}</span>
            {mark ? <span className="student-instant-tag">
              {mark.mark === 'correct' ? <CircleCheck aria-hidden="true" size={18} strokeWidth={2.25} />
                : <CircleX aria-hidden="true" size={18} strokeWidth={2.25} />}{mark.label}
            </span> : null}
            {locked && mark === null ? <span className="student-instant-tag">
              <Lock aria-hidden="true" size={16} strokeWidth={2.25} />{INSTANT_COPY.locked}
            </span> : null}
          </label>
        })}
      </fieldset>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {statusText ? <p role="status" className="student-practice-help student-instant-status">
        {statusText}
        {waiting === 'offline' && pending !== null ? <> <button type="button"
          className={studentAction(btnGhost, 'border-transparent px-2')} onClick={() => { void send(pending) }}>
          Try again</button></> : null}
      </p> : null}
      {shown?.explanation ? <section className="student-instant-why" aria-labelledby={`${id}-why`}>
        <h2 id={`${id}-why`}>{INSTANT_COPY.why}</h2>
        <p>{shown.explanation}</p>
      </section> : null}
    </div>

    <div className="student-instant-next">
      <div className="student-workspace">
        <button type="button" className={studentAction(btnNavy, studentFocusDark, 'w-full')} disabled={shown === undefined}
          onClick={next}>{isLast ? INSTANT_COPY.seeResult : INSTANT_COPY.next}</button>
      </div>
    </div>
  </div>
}
