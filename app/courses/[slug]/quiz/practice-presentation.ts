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
  leaveTitle: 'Leave practice?',
  leaveBody: 'This attempt will end. It can’t be resumed, and your answers won’t be submitted.',
  submitTitle: 'Submit practice?',
  submitBody: 'Submitting ends this attempt. You won’t be able to change your answers.',
  timedOutTitle: 'Time is up. Your attempt has been submitted.',
  timedOutBody: 'Questions you hadn’t answered are counted as missed.',
  saveFailedTitle: 'This result couldn’t be saved.',
  saveFailedBody: 'Your score and answer review are still available on this page until you leave it.',
  saving: 'Saving your result.',
  saved: 'Result saved to your account.',
  bandNote: 'Practice feedback for this attempt only. Not an official grade.',
} as const

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
