// app/courses/[slug]/quiz/practice-presentation.ts — Practice copy, honest course identity and the locked result bands.
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'

export const PRACTICE_COPY = {
  title: 'Practice',
  lede: 'Test your knowledge with timed multiple-choice questions.',
  backToCourse: 'Back to course',
  notBuiltTitle: 'CBT practice is not available for this course.',
  notBuiltBody: 'Check the course page for other study materials, or request the material you need.',
  temporaryBody: 'We couldn’t load the practice questions just now. Your saved results are unaffected.',
  loading: 'Loading practice.',
  starting: 'Starting…',
  timerRule: 'Once you start, the timer keeps running, even if you leave or lose connection.',
  // Start and resume problems. Title and body read as one sentence; Try again appears only where it can help.
  noConnectionTitle: 'No connection.',
  noConnectionBody: 'Reconnect and tap Try again.',
  startRefusedTitle: 'We couldn’t start your practice.',
  resumeFailedTitle: 'We couldn’t open your practice.',
  tryAgainBody: 'Try again.',
  signedOutTitle: 'You’ve been signed out.',
  signedOutBody: 'Sign in again to continue.',
  tryAgain: 'Try again',
  changedTitle: 'Your practice details have changed.',
  changedBody: 'Review them and confirm you’re ready to start.',
  // Exit never ends the attempt: the timer is the server's and keeps running.
  exitTitle: 'Exit practice?',
  exitUnsafe: 'Some answers aren’t saved yet. If you leave now, they’ll be lost.',
  exitSaved: 'Your answers are saved and the timer keeps running. Come back to this page before time runs out to continue.',
  exitNothing: 'The timer keeps running. Come back to this page before time runs out to continue.',
  exitSaving: 'Some answers are still saving on this device. The timer keeps running — come back to this page before time runs out to continue.',
  submitTitle: 'Submit practice?',
  submitBody: 'Submitting ends this attempt. You won’t be able to change your answers.',
  submitPending: 'Your latest answers will be sent with your submission.',
  // Save lines when neither the server nor this device holds the latest answers.
  submitUnsaved: 'Some answers aren’t saved yet. Keep this page open and try submitting again.',
  saveFailedUnsaved: 'Your answers couldn’t be saved. Keep this page open and try again.',
  resumeTitle: 'You have a practice attempt in progress',
  resumeAction: 'Continue practice',
  timeUp: 'Time is up. Getting your result…',
  timeUpOffline: 'Time is up. We’ll show your result as soon as you’re back online.',
  timedOutTitle: 'Time is up. Your attempt has been submitted.',
  timedOutBody: 'Only answers saved before time ran out count. Unanswered questions count as missed.',
  unsentAtDeadline: 'Some answers on this device didn’t reach us before time ran out, so they weren’t counted.',
  saved: 'Result saved to your account.',
  lastResult: 'See your last result',
  resultMissingTitle: 'This practice result isn’t available.',
  // Practice by topic waits while an exam is open in the course, so no answer is marked during it.
  examOpenTitle: 'Finish your exam first.',
  examOpenBody: 'Practice opens again once your exam is submitted or its time runs out.',
  resumeExam: 'Resume exam',
  bandNote: 'Practice feedback for this attempt only. Not an official grade.',
} as const

/** A start or resume problem; `retry` offers Try again, which repeats the same request; `action` links onward. */
export type PracticeProblem = { title: string; body: string; retry?: boolean; action?: { label: string; href: string } }

/** The practice page of one attempt, reloadable. */
export function attemptHref(courseHref: string, attemptId: string): string {
  return `${courseHref}/quiz?attempt=${attemptId}`
}

export const PRACTICE_BAND_THRESHOLDS = { strong: 70, target: 50 } as const
export const LOW_TIME_SECONDS = 5 * 60
const SECONDS_PER_MINUTE = 60
const TEN_MINUTES = 10 * SECONDS_PER_MINUTE

export type PracticeIdentity = {
  context: string
  lede: string
  barCode: string
  barTitle: string
  heading: string
}

/** Institutional code and title win; a repository-only course is named as repository identity, never as an owner. */
export function practiceIdentity(code: string, title: string, repositoryOnly: boolean): PracticeIdentity {
  if (repositoryOnly) {
    return { context: `Additional study material · ${title}`,
      lede: 'CBT practice · Check that this material matches your course and syllabus',
      barCode: title, barTitle: 'Practice', heading: `Practice — ${title}` }
  }
  return { context: `${code} · ${title}`, lede: 'CBT practice · One timed attempt',
    barCode: code, barTitle: `${title} · Practice`, heading: `Practice — ${code} ${title}` }
}

type Resolved = Extract<StudentCourseLookupResult, { status: 'ok' | 'repository-only' }>

/** Resolve the one-course read model into the identity every Practice surface shows. */
export function practiceContext(result: Resolved): PracticeIdentity & { code: string; title: string } {
  const course = result.status === 'ok' ? result.course : result.course.repository.route.course
  return { code: course.code, title: course.title,
    ...practiceIdentity(course.code, course.title, result.status === 'repository-only') }
}

/** This attempt's feedback band; thresholds are the locked design's, not an institutional grade. */
export function practiceBand(percent: number): 'Strong attempt' | 'Practice target met' | 'Keep reviewing' {
  if (percent >= PRACTICE_BAND_THRESHOLDS.strong) return 'Strong attempt'
  if (percent >= PRACTICE_BAND_THRESHOLDS.target) return 'Practice target met'
  return 'Keep reviewing'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** MM:SS from whole seconds; minutes run past 59 so a 60-minute attempt starts at 60:00. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${pad(Math.floor(whole / SECONDS_PER_MINUTE))}:${pad(whole % SECONDS_PER_MINUTE)}`
}

/** Spoken clock for the timer's accessible name. */
export function describeClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `Time left ${Math.floor(whole / SECONDS_PER_MINUTE)} minutes ${whole % SECONDS_PER_MINUTE} seconds`
}

/** One polite announcement per threshold, so the live region changes three times at most. */
export function timerAnnouncement(seconds: number): string {
  if (seconds <= SECONDS_PER_MINUTE) return '1 minute left'
  if (seconds <= LOW_TIME_SECONDS) return '5 minutes left'
  if (seconds <= TEN_MINUTES) return '10 minutes left'
  return ''
}

/** "12 of 50 answered · 2 flagged" — the one progress line shared by the bar, the aside and the sheet. */
export function answeredLine(answered: number, total: number, flagged: number): string {
  return `${answered} of ${total} answered${flagged ? ` · ${flagged} flagged` : ''}`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function minutesOf(seconds: number): number {
  return Math.round(seconds / SECONDS_PER_MINUTE)
}

/** Whole minutes consumed, rounded up so a one-second attempt still reads as one minute used. */
export function minutesUsed(durationSeconds: number, secondsLeft: number): number {
  const used = Math.min(durationSeconds, Math.max(0, durationSeconds - secondsLeft))
  return Math.min(minutesOf(durationSeconds), Math.ceil(used / SECONDS_PER_MINUTE))
}

export const OPTION_LETTERS = 'ABCDEFGHIJ'
export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1)
}

/** What the attempt screen says about time and this tab's answers: one line, and never "saved" before the server
 * confirmed this tab's latest change. Earlier conditions win. */
export function saveLineFor(state: {
  timeUp: boolean; submitFailing: boolean; refusal: string | null; clockSynced: boolean; clockFailures: number
  save: 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed' | null; answered: number; answersSafe?: boolean
}): { text: string; retry: boolean } | null {
  if (state.timeUp) return { text: state.submitFailing ? PRACTICE_COPY.timeUpOffline : PRACTICE_COPY.timeUp, retry: false }
  if (state.refusal !== null) return { text: state.refusal, retry: false }
  // A submission that did not go through with time left: what the server confirmed stays saved, the rest stays here.
  if (state.submitFailing) {
    if (state.answersSafe === false) return { text: PRACTICE_COPY.submitUnsaved, retry: false }
    return { text: state.save === 'saved' || state.save === null
      ? 'Your answers are saved. Submission didn’t go through — try again.'
      : 'Your answers are kept on this device. Submission didn’t go through — try again.', retry: false }
  }
  if (state.save === 'failed') return { text: state.answersSafe === false
    ? PRACTICE_COPY.saveFailedUnsaved
    : 'Your answers couldn’t be saved. They’re still on this device.', retry: true }
  if (!state.clockSynced) {
    return { text: state.clockFailures > 0 ? 'Reconnecting… Answers can’t be changed until the connection is back.'
      : 'Checking the time left…', retry: false }
  }
  if (state.save === 'saving') return { text: 'Saving…', retry: false }
  if (state.save === 'unsaved') return { text: 'Not saved yet. We’ll keep trying.', retry: false }
  if (state.save === 'saved' && state.answered > 0) return { text: 'All answers saved', retry: false }
  return null
}

/** The Exit dialog's promise: "saved" only when the server confirmed every answer this tab gave. */
export function exitBodyFor(save: 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed' | null, answered: number, answersSafe = true): string {
  if (!answersSafe) return `${PRACTICE_COPY.exitUnsafe} ${PRACTICE_COPY.exitNothing}`
  if (save === 'saved' || save === null) return answered > 0 ? PRACTICE_COPY.exitSaved : PRACTICE_COPY.exitNothing
  return PRACTICE_COPY.exitSaving
}
