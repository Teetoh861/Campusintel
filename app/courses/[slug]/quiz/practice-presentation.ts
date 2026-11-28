// app/courses/[slug]/quiz/practice-presentation.ts — Practice copy, honest course identity and the locked result bands.
import { AUTH_PATHS, SIGNED_IN_ON_ANOTHER_TAB } from '@/lib/auth/constants'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'

export const PRACTICE_COPY = {
  // Practice is topic practice, which has no timer. The timed exam is Exam mode on every screen, start to result.
  title: 'Practice',
  backToCourse: 'Back to course',
  // The course page's Practice card: its two ways in. Practise by topic is also the title of the page it opens, and
  // All topics is the way back to that page from a topic's practice. Exam mode is also the title of the exam's screens.
  byTopic: 'Practise by topic',
  examMode: 'Exam mode',
  allTopics: 'All topics',
  topicsFailedTitle: 'We couldn’t load the topics.',
  notBuiltTitle: 'Practice isn’t available for this course.',
  loadFailedTitle: 'We couldn’t load the practice questions.',
  examLoadFailedTitle: 'We couldn’t load the exam.',
  loading: 'Loading practice.',
  loadingExam: 'Loading your exam.',
  starting: 'Starting…',
  startExam: 'Start exam',
  submitExam: 'Submit exam',
  // The owner's line: leaving through Exit or the back button ends the exam, so only a dropped connection is named.
  timerRule: 'The timer keeps running, even if your connection drops.',
  // Start and resume problems: the title says what happened, and the notice's one button is the way on.
  noConnectionTitle: 'No connection.',
  noConnectionBody: '',
  startRefusedTitle: 'We couldn’t start your practice.',
  examStartRefusedTitle: 'We couldn’t start your exam.',
  resumeFailedTitle: 'We couldn’t open your exam.',
  tryAgainBody: '',
  signedOutTitle: 'You’ve been signed out.',
  signedOutBody: '',
  signIn: 'Sign in',
  sessionChangedTitle: SIGNED_IN_ON_ANOTHER_TAB,
  reload: 'Reload',
  tryAgain: 'Try again',
  // The number of questions or the time changed between the brief and the start: the brief shows the new ones.
  changedTitle: 'The exam has changed.',
  changedBody: 'Check the questions and time, then start.',
  // Leaving an exam ends it: Exit and the back button ask "End exam?" (components/student/EndExamDialog.tsx).
  submitTitle: 'Submit exam?',
  submitBody: 'You won’t be able to change your answers.',
  // A submission or a save that did not go through. Each line sits beside its Try again button, which finishes the
  // sentence; what the student has to do meanwhile is keep the page open.
  submitFailed: 'We couldn’t submit your answers. Keep this page open.',
  saveFailed: 'We couldn’t save your answers. Keep this page open.',
  submitting: 'Submitting…',
  // Only a closed browser or a dropped connection leaves an exam open; wherever one is offered, it is this.
  resumeTitle: 'Exam in progress',
  resumeAction: 'Resume your exam',
  // While answers wait for the connection; they stay on this page and go as soon as they can.
  notSaved: 'Not saved yet.',
  timeUp: 'Time is up. Getting your result…',
  timeUpOffline: 'Time is up. We’ll show your result as soon as you’re back online.',
  // The hand-in at time up was not answered after every automatic try, or was refused: never "Getting your result…" for good.
  timeUpRetry: 'Time is up. We couldn’t get your result.',
  timeUpSignedOut: 'Time is up. Sign in to see your result.',
  timeUpGone: 'Time is up. This exam is no longer available.',
  timeUpSessionChanged: `Time is up. ${SIGNED_IN_ON_ANOTHER_TAB}`,
  // On the result of an exam that ran out of time, only when this device still held answers the server never got.
  unsentAtDeadline: 'Some answers weren’t saved in time, so they don’t count.',
  lastResult: 'See your last result',
  seeResult: 'See your result',
  examResultTitle: 'Exam result',
  practiceResultTitle: 'Practice result',
  resultMissingTitle: 'This result isn’t available.',
  examGone: 'This exam is no longer available.',
  practiceGone: 'This practice is no longer available.',
  // Open in more tabs than an exam takes changes from: this tab stops saving, and the others carry on.
  otherTab: 'This exam is open in another tab. Continue there.',
} as const

/** A start or resume problem; `retry` offers Try again, which repeats the same request; `action` links onward. */
export type PracticeProblem = { title: string; body: string; retry?: boolean; action?: { label: string; href: string } }

/** The practice page of one attempt, reloadable. */
export function attemptHref(courseHref: string, attemptId: string): string {
  return `${courseHref}/quiz?attempt=${attemptId}`
}

/** The exam's brief, where an exam starts (also an allow-listed return path, so signing in comes back to it). */
export function examBriefHref(courseHref: string): string {
  return `${courseHref}/quiz?mode=exam`
}

/** Sign in, then come back to this attempt (an allow-listed return path, lib/auth/redirect.ts). */
export function signInToAttemptHref(courseHref: string, attemptId: string): string {
  return `${AUTH_PATHS.login}?next=${encodeURIComponent(attemptHref(courseHref, attemptId))}`
}

/** Why the server refused this tab: its line during the attempt, its line once time is up, and the one way on. */
export type AttemptRefusal = { text: string; timeUpText: string; action?: { label: string; href: string }
  timeUpAction?: { label: string; href: string }; retry?: boolean }

export const PRACTICE_BAND_THRESHOLDS = { strong: 70, target: 50 } as const
export const LOW_TIME_SECONDS = 5 * 60
const SECONDS_PER_MINUTE = 60
const TEN_MINUTES = 10 * SECONDS_PER_MINUTE

export type PracticeIdentity = {
  context: string
  barCode: string
  barTitle: string
  heading: string
}

/** Institutional code and title win; a repository-only course is named as repository identity, never as an owner.
 * `mode` names the screen: Exam mode for the timed exam, Practice for a topic's practice. */
export function practiceIdentity(code: string, title: string, repositoryOnly: boolean,
  mode: 'practice' | 'exam' = 'practice'): PracticeIdentity {
  const name = mode === 'exam' ? PRACTICE_COPY.examMode : PRACTICE_COPY.title
  if (repositoryOnly) {
    return { context: `Additional study material · ${title}`, barCode: title, barTitle: name, heading: `${name} — ${title}` }
  }
  return { context: `${code} · ${title}`, barCode: code, barTitle: `${title} · ${name}`, heading: `${name} — ${code} ${title}` }
}

type Resolved = Extract<StudentCourseLookupResult, { status: 'ok' | 'repository-only' }>

/** Resolve the one-course read model into the identity every Practice surface shows. */
export function practiceContext(result: Resolved): PracticeIdentity & { code: string; title: string } {
  const course = result.status === 'ok' ? result.course : result.course.repository.route.course
  return { code: course.code, title: course.title,
    ...practiceIdentity(course.code, course.title, result.status === 'repository-only') }
}

/** This exam's feedback band; thresholds are the locked design's, not an institutional grade. */
export function practiceBand(percent: number): 'Great work' | 'Good progress' | 'Keep practising' {
  if (percent >= PRACTICE_BAND_THRESHOLDS.strong) return 'Great work'
  if (percent >= PRACTICE_BAND_THRESHOLDS.target) return 'Good progress'
  return 'Keep practising'
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

/** What the exam screen says about time and this tab's answers: one line, and never "saved" before the server
 * confirmed this tab's latest change. Earlier conditions win. */
export function saveLineFor(state: {
  timeUp: boolean; submitFailing: boolean; refusal: AttemptRefusal | null; clockSynced: boolean; clockFailures: number
  save: 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed' | null; answered: number
  // A submission on its way; and, once time is up, whether the automatic tries are still going.
  submitting?: boolean; autoRetrying?: boolean
}): { text: string; retry: boolean; action?: { label: string; href: string } } | null {
  if (state.timeUp) {
    // A hand-in the server refused says why, with the one way on, instead of waiting for a result that won't come.
    if (state.refusal !== null) return { text: state.refusal.timeUpText, retry: state.refusal.retry ?? false, action: state.refusal.timeUpAction }
    if (state.submitFailing && state.autoRetrying === false) return { text: PRACTICE_COPY.timeUpRetry, retry: true }
    return { text: state.submitFailing ? PRACTICE_COPY.timeUpOffline : PRACTICE_COPY.timeUp, retry: false }
  }
  if (state.refusal !== null) return { text: state.refusal.text, retry: false, action: state.refusal.action }
  if (state.submitting) return { text: PRACTICE_COPY.submitting, retry: false }
  // A submission that did not go through with time left: what the server confirmed stays saved, the rest stays on
  // this page, so the one thing to do is keep it open. Try again sends the submission again.
  if (state.submitFailing) return { text: PRACTICE_COPY.submitFailed, retry: true }
  if (state.save === 'failed') return { text: PRACTICE_COPY.saveFailed, retry: true }
  // The time left shows from the first render; only an exchange with the server that keeps failing is mentioned.
  if (!state.clockSynced && state.clockFailures > 0) {
    return { text: 'Reconnecting… Answers can’t be changed until the connection is back.', retry: false }
  }
  if (state.save === 'saving') return { text: 'Saving…', retry: false }
  if (state.save === 'unsaved') return { text: PRACTICE_COPY.notSaved, retry: false }
  if (state.save === 'saved' && state.answered > 0) return { text: 'All answers saved', retry: false }
  return null
}
