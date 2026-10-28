// components/landing/TryQuestionQuiz.tsx — Two real bank questions with instant feedback or exam mode; nothing is fetched or saved.
'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Timer, X } from 'lucide-react'
import { btnAccent, btnBase, btnGhost, btnSm, buttonClassName } from '@/components/chrome/ui'
import { fillTemplate } from '@/lib/landing/format'
import styles from './landing.module.css'
import type { landingContent, SampleQuestion } from '@/lib/landing/content'
import type { ReactElement, ReactNode } from 'react'

type Copy = Omit<typeof landingContent.tryQuestion, 'questions'>
type Props = { copy: Copy; questions: SampleQuestion[]; intro: ReactNode; botSrc: string }
type Verdict = 'right' | 'wrong' | 'saved' | null

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const OPTION = 'w-full justify-start gap-3 rounded-[12px] border-[1.5px] border-student-border bg-student-brand-surface px-[14px] py-[11px] text-left text-[16px] font-normal leading-snug text-student-text-primary hover:border-ci-blue-600 hover:bg-student-brand-surface'
const OPTION_STATE: Record<Exclude<Verdict, null>, string> = {
  right: 'border-student-success bg-student-success-surface hover:border-student-success hover:bg-student-success-surface',
  wrong: 'border-dashed border-student-primary hover:border-student-primary',
  saved: 'border-ci-blue-600',
}
const KEY_STATE: Record<Exclude<Verdict, null>, string> = { right: styles.keyRight, wrong: styles.keyWrong, saved: styles.keySaved }

/** Right and wrong are shown with an icon and a word, never colour alone. */
export function TryQuestionQuiz({ copy, questions, intro, botSrc }: Props): ReactElement {
  const [exam, setExam] = useState(false)
  const [index, setIndex] = useState(0)
  const [picks, setPicks] = useState<Array<number | null>>(() => questions.map(() => null))
  const [finished, setFinished] = useState(false)
  const questionRef = useRef<HTMLHeadingElement>(null)
  const scoreRef = useRef<HTMLParagraphElement>(null)

  const current = questions[index]
  const pick = picks[index]
  const answered = pick !== null
  const right = picks.filter((choice, i) => choice === questions[i].answer).length
  const last = index === questions.length - 1

  const restart = (nextExam: boolean): void => {
    setExam(nextExam)
    setIndex(0)
    setPicks(questions.map(() => null))
    setFinished(false)
  }
  const choose = (option: number): void => {
    if (answered) return
    setPicks(previous => previous.map((choice, i) => (i === index ? option : choice)))
  }
  const advance = (): void => {
    if (!answered) return
    if (!last) {
      setIndex(index + 1)
      requestAnimationFrame(() => questionRef.current?.focus())
      return
    }
    setFinished(true)
    requestAnimationFrame(() => scoreRef.current?.focus())
  }
  const playAgain = (): void => {
    restart(exam)
    requestAnimationFrame(() => questionRef.current?.focus())
  }

  const verdictFor = (option: number): Verdict => {
    if (!answered) return null
    if (exam) return option === pick ? 'saved' : null
    if (option === current.answer) return 'right'
    return option === pick ? 'wrong' : null
  }
  const bubble = finished
    ? (right === questions.length ? copy.bubble.perfect : copy.bubble.other)
    : !answered ? copy.bubble.start
      : exam ? copy.bubble.saved
        : pick === current.answer ? copy.bubble.right : copy.bubble.wrong
  const endMessage = right === questions.length ? copy.endPerfect : right > 0 ? copy.endSome : copy.endNone

  return (
    <>
      <div>
        {intro}
        <div className={styles.mode}>
          <button type="button" role="switch" aria-checked={exam} onClick={() => restart(!exam)}
            className={buttonClassName(btnBase, btnGhost, 'gap-3 border-transparent px-0 text-[17px] hover:border-transparent hover:bg-transparent active:bg-transparent')}>
            <span className={styles.switch} aria-hidden="true" />
            {copy.modeSwitch}
          </button>
          <p className={styles.modeNote}>{exam ? copy.modeExam : copy.modeInstant}</p>
        </div>
      </div>

      <div className={styles.quizWrap}>
        <p className={styles.bubble} aria-hidden="true">{bubble}</p>
        <div className={styles.qbot} aria-hidden="true">
          <span className={styles.face} />
          <Image src={botSrc} width={420} height={400} alt="" sizes="92px" className={styles.botImg} />
        </div>
        <div className={styles.quiz} role="group" aria-label={copy.cardLabel}>
          {finished ? (
            <div className={styles.end}>
              <p ref={scoreRef} tabIndex={-1} className={styles.big}>
                <span aria-hidden="true">{fillTemplate(copy.score, { right, total: questions.length })}</span>
                <span className="sr-only">{fillTemplate(copy.scoreLabel, { right, total: questions.length })}</span>
              </p>
              <strong>{endMessage}</strong>
              <p>{copy.endText}</p>
              <Link href={copy.cta.href} prefetch={false} className={buttonClassName(btnBase, btnAccent, 'rounded-full px-[26px] font-bold')}>
                {copy.cta.label}
              </Link>
              <button type="button" onClick={playAgain} className={buttonClassName(btnBase, btnSm, btnGhost, 'border-transparent text-student-link')}>
                {copy.again}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.quizHead}>
                <span className={styles.coursePill}>{current.course}</span>
                <span className={styles.modeTag}><Timer aria-hidden="true" size={16} />{exam ? copy.labelExam : copy.labelPractice}</span>
              </div>
              <h3 ref={questionRef} tabIndex={-1} className={styles.question}>
                <span className="sr-only">{fillTemplate(copy.progress, { current: index + 1, total: questions.length })}. </span>
                {current.question}
              </h3>
              <div className={styles.opts}>
                {current.options.map((option, optionIndex) => {
                  const verdict = verdictFor(optionIndex)
                  return (
                    <button key={option} type="button" onClick={() => choose(optionIndex)}
                      className={buttonClassName(btnBase, btnGhost, OPTION, verdict && OPTION_STATE[verdict],
                        verdict === 'wrong' && styles.shake, answered && 'cursor-default')}>
                      <span className={`${styles.key} ${verdict ? KEY_STATE[verdict] : ''}`} aria-hidden="true">{LETTERS[optionIndex]}</span>
                      <span className={styles.optText}>{option}</span>
                      {verdict === 'right' && <span className={`${styles.verdict} text-student-success`}><Check aria-hidden="true" size={16} />{copy.correct}</span>}
                      {verdict === 'wrong' && <span className={`${styles.verdict} text-student-primary`}><X aria-hidden="true" size={16} />{copy.wrong}</span>}
                      {verdict === 'saved' && <span className={`${styles.verdict} text-student-link`}>{copy.yourAnswer}</span>}
                    </button>
                  )
                })}
              </div>
              <div className={`${styles.explain} ${answered ? styles.explainOpen : ''}`} aria-live="polite">
                {!answered ? (exam ? copy.promptExam : copy.promptInstant)
                  : exam ? copy.savedExam
                    : <><strong>{copy.explanationLabel}</strong> {current.explanation}</>}
              </div>
              <div className={styles.quizFoot}>
                <div className={styles.steps} aria-hidden="true">
                  {questions.map((question, i) => (
                    <i key={question.questionId} className={`${styles.stepDot} ${i < index ? styles.stepDone : i === index ? styles.stepNow : ''}`} />
                  ))}
                </div>
                <button type="button" onClick={advance} disabled={!answered}
                  className={buttonClassName(btnBase, btnSm, btnGhost, 'border-transparent text-student-link')}>
                  {last ? copy.finish : copy.next}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
