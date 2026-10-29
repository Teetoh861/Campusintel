// app/courses/[slug]/quiz/instant-feedback.ts — Instant feedback rules that need no React: where a resumed attempt
// continues, how each option is marked once its question is picked, the end-screen line and the result haptics.
import type { OpenQuestion, PickFeedback } from '@/lib/practice/contract'

export const INSTANT_COPY = {
  choiceTitle: 'Instant feedback',
  choiceBody: 'See each answer as you go.',
  examTitle: 'Exam mode',
  examBody: 'Timed, results at the end.',
  choose: 'Choose how you want to practise.',
  correct: 'Correct',
  yourAnswer: 'Your answer',
  correctAnswer: 'Correct answer',
  locked: 'Locked',
  why: 'Why',
  next: 'Next',
  seeResult: 'See result',
  exit: 'Exit',
  checking: 'Checking your answer…',
  offline: 'No connection. Your answer is kept and will be checked when you’re back online.',
  signedOut: 'You’ve been signed out. Sign in again on this device. Your answer is kept.',
  practiseAgain: 'Practise again',
} as const

/** Resume on the first question not yet picked; the last question when every one has been. */
export function firstOpenQuestion(questions: ReadonlyArray<Pick<OpenQuestion, 'feedback'>>): number {
  const open = questions.findIndex(question => question.feedback === undefined)
  return open === -1 ? Math.max(0, questions.length - 1) : open
}

export type OptionMark = { mark: 'correct' | 'incorrect'; label: string } | null

/** How one option reads once its question is picked: never colour alone, always an icon and a label with it. */
export function optionMarkOf(index: number, feedback: PickFeedback | undefined): OptionMark {
  if (feedback === undefined) return null
  const right = feedback.selected === feedback.correctOption
  if (index === feedback.selected) {
    return right ? { mark: 'correct', label: INSTANT_COPY.correct } : { mark: 'incorrect', label: INSTANT_COPY.yourAnswer }
  }
  if (index === feedback.correctOption) return { mark: 'correct', label: INSTANT_COPY.correctAnswer }
  return null
}

/** "7 of 10 right": correct out of the questions answered. */
export function instantScoreLine(score: number, answered: number): string {
  return answered === 0 ? 'No questions answered' : `${score} of ${answered} right`
}

// Right: one 10 ms pulse. Wrong: two 10 ms pulses 60 ms apart.
const RIGHT_PULSE = 10
const WRONG_PATTERN = [10, 60, 10]

export function hapticPattern(isCorrect: boolean): number | number[] {
  return isCorrect ? RIGHT_PULSE : [...WRONG_PATTERN]
}

export type HapticEnv = { vibrate?: (pattern: number | number[]) => boolean; visible: boolean; tapped: boolean }

/** Vibrate for a result the server has just returned: only where the device can (Android; iOS has no vibrate), only
 * after the student has tapped on this page, and never while the page is hidden. */
export function vibrateForResult(isCorrect: boolean, env: HapticEnv): boolean {
  if (env.vibrate === undefined || !env.visible || !env.tapped) return false
  try { return env.vibrate(hapticPattern(isCorrect)) } catch { return false }
}

/** The browser's haptic environment, read at the moment a result arrives. */
export function browserHapticEnv(tapped: boolean): HapticEnv {
  const vibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator
    ? (pattern: number | number[]) => navigator.vibrate(pattern) : undefined
  return { vibrate, visible: typeof document !== 'undefined' && document.visibilityState === 'visible', tapped }
}
