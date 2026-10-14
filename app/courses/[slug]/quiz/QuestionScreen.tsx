// app/courses/[slug]/quiz/QuestionScreen.tsx — The focused attempt: context bar, timer, one question, native answers, navigator.
'use client'

import { useEffect, useId, useRef } from 'react'
import { Check, Clock, Flag } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { useIsDesktop } from '@/components/ui/use-mobile'
import { Navigator, NavigatorLegend } from './Navigator'
import { focusFirst } from './focus-return'
import { answeredLine, describeClock, formatClock, optionLetter, practiceIdentity, timerAnnouncement } from './practice-presentation'
import type { ManagedQuizQuestion } from '@/lib/managed-content/student-projection'
import type { AnswersMap, MarkedMap } from './types'
import type { ReactElement } from 'react'

type Props = {
  courseCode: string
  courseTitle: string
  repositoryOnly: boolean
  question: ManagedQuizQuestion
  current: number
  total: number
  selected: number | undefined
  isMarked: boolean
  timeLeft: number
  isLowTime: boolean
  navOpen: boolean
  answeredCount: number
  markedCount: number
  answersMap: AnswersMap
  markedMap: MarkedMap
  onSelectOption: (optionIndex: number) => void
  onToggleMark: () => void
  onPrev: () => void
  onNext: () => void
  onJump: (index: number) => void
  // Confirmations return focus to the first listed control that still exists, never to the body.
  onSubmit: (returnFocusTo: ReadonlyArray<HTMLElement | null>) => void
  onOpenNav: () => void
  onCloseNav: () => void
  onLeave: (returnFocusTo: ReadonlyArray<HTMLElement | null>) => void
}

/** Present exactly one question; the page's only h1 names the practice, never the prompt. */
export function QuestionScreen(props: Props): ReactElement {
  const { question, current, total, selected, isMarked, timeLeft, isLowTime, navOpen,
    answeredCount, markedCount, answersMap, markedMap, onCloseNav } = props
  const id = useId()
  const desktop = useIsDesktop()
  const navTrigger = useRef<HTMLButtonElement>(null)
  const flagControl = useRef<HTMLButtonElement>(null)
  // From 1200 the inline navigator is the only navigator: the sheet closes on the crossing and stays closed on the way back.
  const sheetOpen = navOpen && !desktop
  useEffect(() => { if (desktop && navOpen) onCloseNav() }, [desktop, navOpen, onCloseNav])
  // The Questions trigger takes focus back; when it is hidden at desktop, the question's own Flag control does.
  const sheetReturnFocus = () => [navTrigger.current, flagControl.current]
  const positionId = `${id}-position`
  const promptId = `${id}-prompt`
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)
  const progress = answeredLine(answeredCount, total, markedCount)
  const isLast = current === total - 1
  const navigator = <Navigator total={total} current={current} answersMap={answersMap} markedMap={markedMap} onJump={props.onJump} />

  return <Sheet open={sheetOpen} onOpenChange={open => { if (open) props.onOpenNav(); else onCloseNav() }}>
    <div className="student-practice-bar">
      <div className="student-workspace student-practice-bar-inner">
        <p className="student-practice-context"><b>{identity.barCode}</b> · {identity.barTitle}</p>
        <div className="student-practice-tools">
          <button type="button" className={studentAction(btnGhost, 'border-transparent px-3')} aria-haspopup="dialog"
            onClick={event => props.onLeave([event.currentTarget])}>
            Leave practice
          </button>
          <div className="student-practice-timer" role="timer" aria-label={describeClock(timeLeft)} data-urgency={isLowTime ? 'low' : undefined}>
            <Clock aria-hidden="true" size={18} strokeWidth={2} />
            <span className="student-practice-timer-label">Time left</span>
            <span>{formatClock(timeLeft)}</span>
            {isLowTime ? <span className="student-practice-timer-suffix">left</span> : null}
          </div>
          <span className="sr-only" aria-live="polite">{timerAnnouncement(timeLeft)}</span>
          <span className="student-practice-mobile">
            <SheetTrigger asChild>
              <button ref={navTrigger} type="button" className={studentAction(btnGhost, 'px-3')}>Questions</button>
            </SheetTrigger>
          </span>
        </div>
      </div>
    </div>

    <div className="student-workspace student-practice-main">
      <h1 className="sr-only">{identity.heading}</h1>
      <div className="student-practice-columns">
        <div className="student-practice-question">
          <div className="student-practice-qhead">
            <p className="student-practice-position" id={positionId}>Question {current + 1} <span>of {total}</span></p>
            <button ref={flagControl} type="button" className="student-practice-flag student-focus-control" aria-pressed={isMarked} onClick={props.onToggleMark}>
              <Flag aria-hidden="true" size={18} strokeWidth={2} />
              <span>{isMarked ? 'Flagged' : 'Flag question'}</span>
            </button>
          </div>
          <p className="student-practice-prompt" id={promptId}>{question.question}</p>
          <fieldset className="student-practice-options" aria-labelledby={`${positionId} ${promptId}`}>
            <legend className="sr-only">Choose one answer</legend>
            {question.options.map((text, index) => {
              const checked = selected === index
              return <label key={index} className="student-practice-option" data-selected={checked ? 'true' : undefined}>
                <input className="sr-only" type="radio" name={`${id}-answer`} value={index} checked={checked}
                  onChange={() => props.onSelectOption(index)} />
                <span className="student-practice-option-mark" aria-hidden="true">{optionLetter(index)}</span>
                <span className="student-practice-option-text">{text}</span>
                <span className="student-practice-option-check" aria-hidden="true">
                  <Check size={16} strokeWidth={2.5} /><span className="student-practice-option-check-text">Selected</span>
                </span>
              </label>
            })}
          </fieldset>
          <div className="student-practice-steps">
            <button type="button" className={studentAction(btnGhost)} disabled={current === 0} onClick={props.onPrev}>Previous</button>
            <button type="button" className={studentAction(btnNavy, studentFocusDark)} aria-haspopup={isLast ? 'dialog' : undefined}
              onClick={event => { if (isLast) props.onSubmit([event.currentTarget]); else props.onNext() }}>{isLast ? 'Submit practice' : 'Next'}</button>
          </div>
          <div className="student-practice-after student-practice-mobile">
            <span>{progress}</span>
            <button type="button" className={studentAction(btnGhost, 'border-transparent')} aria-haspopup="dialog"
              onClick={event => props.onSubmit([event.currentTarget])}>
              Submit practice
            </button>
          </div>
        </div>

        <aside className="student-practice-desktop" aria-label="Question navigator">
          <div className="student-practice-aside">
            <h2>Questions</h2>
            <p className="student-practice-count">{progress}</p>
            {navigator}
            <NavigatorLegend />
            <div className="mt-5 flex flex-col">
              <button type="button" className={studentAction(btnNavy, studentFocusDark)} aria-haspopup="dialog"
                onClick={event => props.onSubmit([event.currentTarget])}>
                Submit practice
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <SheetContent side="bottom" className="student-practice-sheet z-[70] rounded-t-[16px] border-student-border bg-student-surface p-5 text-student-text-primary"
        closeClassName="student-focus-control top-5 right-5 h-11 w-11 flex items-center justify-center opacity-100 text-student-primary"
        onCloseAutoFocus={event => { if (focusFirst(sheetReturnFocus())) event.preventDefault() }}>
        <SheetHeader className="pr-12 text-left">
          <SheetTitle className="text-[20px] font-bold text-student-primary">Questions</SheetTitle>
          <SheetDescription className="text-[14px] text-student-text-muted">{progress}</SheetDescription>
        </SheetHeader>
        <div className="student-practice-navscroll" tabIndex={0} role="region" aria-label="Question numbers">{navigator}</div>
        <NavigatorLegend />
        <div className="student-practice-foot mt-5">
          <button type="button" className={studentAction(btnGhost)} onClick={onCloseNav}>Back to question {current + 1}</button>
          {/* This button leaves with the sheet, so the stable Questions trigger is the confirmation's return target. */}
          <button type="button" className={studentAction(btnNavy, studentFocusDark)} aria-haspopup="dialog"
            onClick={() => { onCloseNav(); props.onSubmit(sheetReturnFocus()) }}>Submit practice</button>
        </div>
      </SheetContent>
  </Sheet>
}
