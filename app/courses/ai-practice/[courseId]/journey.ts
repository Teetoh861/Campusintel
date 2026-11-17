// app/courses/ai-practice/[courseId]/journey.ts — Browser-side upload → read → generate sequence, free of React.
// Each step reports progress; every failure becomes a student-safe message. fetch is injected for tests.
import { AUTH_CONTINUITY_HEADER, SIGNED_IN_ON_ANOTHER_TAB } from '@/lib/auth/constants'
import { CAMPUS_BOT_LIMIT_COPY, FREE_PASS_COPY, NEUTRAL_TRIAL_WORDING, accessCopy, trialGrantName } from '@/lib/entitlements/presentation'
import { MAX_UPLOAD_BYTES, UPLOAD_REJECTION_MESSAGES, mediaTypeForFileName } from '@/lib/ai-practice/upload-contract'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { AiPracticeCommand, AiPracticeResult, AllowanceSummary, PersonalSetView }
  from '@/lib/ai-practice/upload-contract'
import type { TrialWording } from '@/lib/entitlements/presentation'

export type JourneyPhase = 'uploading' | 'reading' | 'generating'

export type JourneyOutcome =
  | { kind: 'generated'; set: PersonalSetView; allowance: AllowanceSummary | null }
  | { kind: 'problem'; tone: 'error' | 'info'; title: string; message: string; retry: 'same-file' | 'new-file' | 'none'
      // signedOut: the page loads again and its account gate takes over. link: the one place the message points to.
      allowance?: AllowanceSummary | null; signedOut?: boolean; link?: { label: string; href: string }
      /** Present when the file was read successfully, so "try again" regenerates without re-uploading. */
      documentId?: string }

/**
 * Idempotency keys for generate requests, one per document. A key is reused for every retry until the server
 * reports an outcome it recorded against that key, so a lost response, a transport failure or a busy reply is
 * retried as the same request and can never start, or be charged for, a second generation.
 */
export type GenerationRequests = {
  requestIdFor(documentId: string): string
  settle(documentId: string, result: AiPracticeResult): void
}

// Outcomes stored against the request id: retrying that id would only replay them, so the student's next attempt
// is a new generation with a new id. Every other result, including no result at all, keeps the id.
const RECORDED_OUTCOMES: ReadonlySet<AiPracticeResult['status']> = new Set(['generated', 'generation-failed',
  'insufficient-source', 'flagged-for-review', 'invalid-request'])

export function createGenerationRequests(newId: () => string): GenerationRequests {
  const pending = new Map<string, string>()
  return {
    requestIdFor(documentId) {
      const existing = pending.get(documentId)
      if (existing) return existing
      const requestId = newId()
      pending.set(documentId, requestId)
      return requestId
    },
    settle(documentId, result) {
      if (RECORDED_OUTCOMES.has(result.status)) pending.delete(documentId)
    },
  }
}

export type JourneyDeps = {
  fetch: typeof fetch
  continuityToken: string
  courseId: string
  /** The student's own trial grant and whether this student is eligible to start a pass (lib/entitlements/presentation.ts
   *  trialWording); copy names a free pass only where that is what the student holds or can get. */
  trial: TrialWording
  /** The copy switch (plans_on_sale): "included when you subscribe" once plans are on sale. */
  plansOnSale?: boolean
  /** The course's own page, for the one message that sends the student there. */
  courseHref?: string
  onPhase(phase: JourneyPhase): void
  requests: GenerationRequests
}

// A question set's day in words, in Lagos time like every date students see (the same on the server and in the browser).
const SET_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' })
export function setDateLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : SET_DAY.format(date)
}

/** Whether the closed message offers this student a free pass: only when they are eligible for one. */
const passOffered = (trial: TrialWording, plansOnSale: boolean): boolean => !plansOnSale && trial.passAvailable

/** Where Campus Bot opens, in one line. The pass is named only when this student is eligible for one. (A student who
 *  can claim a free month is shown that instead, by the page.) */
export function notEntitledMessage(trial: TrialWording, plansOnSale: boolean = false): string {
  if (plansOnSale) return accessCopy(true).aiNotEntitled
  return passOffered(trial, plansOnSale) ? 'Campus Bot opens with a free pass.' : accessCopy(false).aiNotEntitled
}

/** The button under that message when it offers the pass: the pass is started on Plan & Access. */
export function freePassAction(trial: TrialWording, plansOnSale: boolean = false): { label: string; href: string } | null {
  return passOffered(trial, plansOnSale) ? { label: FREE_PASS_COPY.start, href: STUDENT_DESTINATIONS.access.href } : null
}

/** How the student's grant is named in copy: a trial grant by the policy it was actually issued under (a Discovery
 *  Pass, or the seven-day free trial from before it), and neutrally when that policy is not known. */
export function grantName(allowance: AllowanceSummary | null | undefined, trial: TrialWording): string {
  if (allowance?.source !== 'trial') return 'Campus Bot access'
  return trialGrantName(trial.policy)
}

const problem = (title: string, message: string, retry: 'same-file' | 'new-file' | 'none' = 'new-file',
  tone: 'error' | 'info' = 'error'): Extract<JourneyOutcome, { kind: 'problem' }> =>
  ({ kind: 'problem', tone, title, message, retry })

/** Map any non-success result to what the student should read and do next. */
export function describeResult(result: AiPracticeResult, trial: TrialWording = NEUTRAL_TRIAL_WORDING,
  plansOnSale: boolean = false, courseHref?: string): JourneyOutcome {
  switch (result.status) {
    case 'generated': return { kind: 'generated', set: result.set, allowance: result.allowance }
    case 'upload-rejected': return problem('We couldn’t use this file.', UPLOAD_REJECTION_MESSAGES[result.reason])
    case 'insufficient-source': return { ...problem('Not enough to work with.',
      'Your notes did not contain enough clear material for five fair questions. Try fuller notes on one topic. ' +
      'This did not use any of your Campus Bot allowance.', 'new-file', 'info'), allowance: result.allowance }
    // Each title says what happened; the line under it says only what is new.
    case 'flagged-for-review': return { ...problem('We couldn’t use this file.',
      'Upload clear study notes for this course.', 'new-file', 'info'), allowance: result.allowance }
    case 'generation-failed': return { ...problem('We couldn’t create your questions.', 'Try again.', 'same-file'),
      allowance: result.allowance }
    case 'allowance-exhausted': return { ...problem('You’ve used your Campus Bot allowance.',
      'Your course materials stay available.', 'none', 'info'), allowance: result.allowance }
    case 'allowance-expired': return { ...problem('Your Campus Bot access has ended.',
      `Your ${grantName(result.allowance, trial)} has ended. Your course materials stay available.`, 'none', 'info'),
      allowance: result.allowance }
    case 'not-entitled': return { ...problem(notEntitledMessage(trial, plansOnSale), '', 'none', 'info'),
      link: freePassAction(trial, plansOnSale) ?? { label: STUDENT_DESTINATIONS.access.label, href: STUDENT_DESTINATIONS.access.href } }
    case 'campus-bot-limit': {
      const limit = CAMPUS_BOT_LIMIT_COPY[result.limit]
      return problem(limit.title, limit.line(result.resetsAt), 'none', 'info')
    }
    case 'busy': return problem('Still preparing your questions.',
      'Please wait a moment, then try again.', 'same-file', 'info')
    case 'capacity': return problem('Campus Bot is busy.', 'Try again in a few minutes.', 'same-file', 'info')
    case 'upload-limit': return problem('Daily upload limit reached.', 'Try again tomorrow.', 'none', 'info')
    case 'pass-upload-limit': return problem('Free pass uploads used.', '', 'none', 'info')
    case 'not-eligible': return { ...problem('This course has study materials.', '', 'none', 'info'),
      ...(courseHref === undefined ? {} : { link: { label: 'Go to course', href: courseHref } }) }
    case 'signed-out': return { ...problem('You’ve been signed out.', 'Sign in again to continue.', 'none'), signedOut: true }
    // The page loads again for the current sign-in, as it does when signed out.
    case 'session-changed': return { ...problem(SIGNED_IN_ON_ANOTHER_TAB, '', 'none'), signedOut: true }
    case 'disabled': return problem('Campus Bot is unavailable.', 'Try again later.', 'none', 'info')
    case 'not-found': return problem('We couldn’t find your file.', 'Choose it again.')
    default: return problem('Something went wrong.', 'Check your connection and try again.', 'same-file')
  }
}

async function command(deps: JourneyDeps, body: AiPracticeCommand): Promise<AiPracticeResult> {
  try {
    const response = await deps.fetch('/api/ai-practice', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: deps.continuityToken },
      body: JSON.stringify(body),
    })
    const parsed: unknown = await response.json()
    if (typeof parsed === 'object' && parsed !== null && 'status' in parsed) return parsed as AiPracticeResult
  } catch { /* Network and parse failures fall through to unavailable. */ }
  return { status: 'unavailable' }
}

/** Check a picked file before anything leaves the device. The server re-checks all of it. */
export function checkFile(file: Pick<File, 'name' | 'size'>): JourneyOutcome | null {
  if (mediaTypeForFileName(file.name) === null) return describeResult({ status: 'upload-rejected', reason: 'unsupported-type' })
  if (file.size === 0) return describeResult({ status: 'upload-rejected', reason: 'empty' })
  if (file.size > MAX_UPLOAD_BYTES) return describeResult({ status: 'upload-rejected', reason: 'too-large' })
  return null
}

/** Upload a new file, have it read, then generate. */
export async function runUploadJourney(file: File, deps: JourneyDeps): Promise<JourneyOutcome> {
  const invalid = checkFile(file)
  if (invalid) return invalid
  const mediaType = mediaTypeForFileName(file.name)!
  deps.onPhase('uploading')
  const reserved = await command(deps, { operation: 'reserve-upload', courseId: deps.courseId,
    fileName: file.name, mediaType, byteSize: file.size })
  if (reserved.status !== 'upload-reserved') return describeResult(reserved, deps.trial, deps.plansOnSale, deps.courseHref)
  try {
    // Straight to private Storage: the file never passes through an application function.
    const put = await deps.fetch(reserved.uploadUrl, { method: 'PUT', cache: 'no-store',
      headers: { 'Content-Type': mediaType, 'x-upsert': 'false' }, body: file })
    if (put.status === 413) return describeResult({ status: 'upload-rejected', reason: 'too-large' })
    if (!put.ok) return problem('Upload failed.', 'Your file did not finish uploading. Check your connection and try again.')
  } catch {
    return problem('Upload failed.', 'Your file did not finish uploading. Check your connection and try again.')
  }
  deps.onPhase('reading')
  const processed = await command(deps, { operation: 'process-upload', documentId: reserved.documentId })
  if (processed.status !== 'upload-ready') return describeResult(processed, deps.trial, deps.plansOnSale, deps.courseHref)
  return generateFromDocument(reserved.documentId, deps)
}

/** Generate five new questions from an already-read document. */
export async function generateFromDocument(documentId: string, deps: JourneyDeps): Promise<JourneyOutcome> {
  deps.onPhase('generating')
  const result = await command(deps, { operation: 'generate', documentId,
    requestId: deps.requests.requestIdFor(documentId) })
  deps.requests.settle(documentId, result)
  const outcome = describeResult(result, deps.trial, deps.plansOnSale, deps.courseHref)
  return outcome.kind === 'problem' && outcome.retry === 'same-file' ? { ...outcome, documentId } : outcome
}
