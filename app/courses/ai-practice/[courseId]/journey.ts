// app/courses/ai-practice/[courseId]/journey.ts — Browser-side upload → read → generate sequence, free of React.
// Each step reports progress; every failure becomes a student-safe message. fetch is injected for tests.
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { NEUTRAL_TRIAL_WORDING, trialGrantName } from '@/lib/entitlements/presentation'
import { MAX_UPLOAD_BYTES, UPLOAD_REJECTION_MESSAGES, mediaTypeForFileName } from '@/lib/ai-practice/upload-contract'
import type { AiPracticeCommand, AiPracticeResult, AllowanceSummary, PersonalSetView }
  from '@/lib/ai-practice/upload-contract'
import type { TrialWording } from '@/lib/entitlements/presentation'

export type JourneyPhase = 'uploading' | 'reading' | 'generating'

export type JourneyOutcome =
  | { kind: 'generated'; set: PersonalSetView; allowance: AllowanceSummary | null }
  | { kind: 'problem'; tone: 'error' | 'info'; title: string; message: string; retry: 'same-file' | 'new-file' | 'none'
      allowance?: AllowanceSummary | null; signedOut?: boolean
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
   *  trialWording); copy names a Discovery Pass only where that is what the student holds or can get. */
  trial: TrialWording
  onPhase(phase: JourneyPhase): void
  requests: GenerationRequests
}

export const NOT_ENTITLED_TITLE = 'AI practice is not included in your account'

/** Why AI practice is closed and where it opens. The pass is named only when this student is eligible for one. */
export function notEntitledMessage(trial: TrialWording): string {
  return trial.passAvailable
    ? 'AI practice opens with a Discovery Pass or Early Access. Get your pass from Plan & Access. GST courses stay free.'
    : 'AI practice opens with Early Access. GST courses stay free.'
}

/** How the student's grant is named in copy: a trial grant by the policy it was actually issued under (a Discovery
 *  Pass, or the seven-day free trial from before it), and neutrally when that policy is not known. */
export function grantName(allowance: AllowanceSummary | null | undefined, trial: TrialWording): string {
  if (allowance?.source !== 'trial') return 'AI access'
  return trialGrantName(trial.policy)
}

const problem = (title: string, message: string, retry: 'same-file' | 'new-file' | 'none' = 'new-file',
  tone: 'error' | 'info' = 'error'): Extract<JourneyOutcome, { kind: 'problem' }> =>
  ({ kind: 'problem', tone, title, message, retry })

/** Map any non-success result to what the student should read and do next. */
export function describeResult(result: AiPracticeResult, trial: TrialWording = NEUTRAL_TRIAL_WORDING): JourneyOutcome {
  switch (result.status) {
    case 'generated': return { kind: 'generated', set: result.set, allowance: result.allowance }
    case 'upload-rejected': return problem('We could not use this file', UPLOAD_REJECTION_MESSAGES[result.reason])
    case 'insufficient-source': return { ...problem('Not enough to work with',
      'Your notes did not contain enough clear material for five fair questions. Try fuller notes on one topic. ' +
      'This did not use any of your AI allowance.', 'new-file', 'info'), allowance: result.allowance }
    case 'flagged-for-review': return { ...problem('We could not generate questions from this file',
      'We couldn’t use this material for course practice. Upload clear, appropriate study notes for this course instead. ' +
      'This did not use any of your AI allowance.', 'new-file', 'info'), allowance: result.allowance }
    case 'generation-failed': return { ...problem('Your questions could not be created',
      'Something went wrong while writing your questions. This did not use any of your AI allowance. Try again.',
      'same-file'), allowance: result.allowance }
    case 'allowance-exhausted': return { ...problem('AI allowance used up',
      `You have used all of the AI practice included in your ${grantName(result.allowance, trial)}. ` +
      'Verified CampusIntell content stays available.', 'none', 'info'), allowance: result.allowance }
    case 'allowance-expired': return { ...problem('AI access has ended',
      `Your ${grantName(result.allowance, trial)} has ended. Verified CampusIntell content stays available.`, 'none', 'info'),
      allowance: result.allowance }
    case 'not-entitled': return problem(NOT_ENTITLED_TITLE, notEntitledMessage(trial), 'none', 'info')
    case 'busy': return problem('Your questions are still being prepared',
      'Please wait a moment, then try again.', 'same-file', 'info')
    case 'capacity': return problem('AI practice is busy',
      'Too many students are generating questions right now. Try again later.', 'same-file', 'info')
    case 'upload-limit': return problem('Daily upload limit reached',
      'You have uploaded the maximum number of files for today. Try again tomorrow.', 'none', 'info')
    case 'pass-upload-limit': return problem('Discovery Pass uploads used',
      'Your pass includes a small number of uploads and they have been used. They do not renew.', 'none', 'info')
    case 'not-eligible': return problem('This course has verified content',
      'Use the CampusIntell study material for this course instead.', 'none', 'info')
    case 'signed-out': return { ...problem('Signed out', 'Sign in again to continue.', 'none'), signedOut: true }
    case 'session-changed': return problem('Your sign-in has changed', 'Reload this page and try again.', 'none')
    case 'disabled': return problem('AI practice is not available', 'Try again later.', 'none', 'info')
    case 'not-found': return problem('Upload not found', 'Choose your file again.')
    default: return problem('Something went wrong', 'Check your connection and try again.', 'same-file')
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
  if (reserved.status !== 'upload-reserved') return describeResult(reserved, deps.trial)
  try {
    // Straight to private Storage: the file never passes through an application function.
    const put = await deps.fetch(reserved.uploadUrl, { method: 'PUT', cache: 'no-store',
      headers: { 'Content-Type': mediaType, 'x-upsert': 'false' }, body: file })
    if (put.status === 413) return describeResult({ status: 'upload-rejected', reason: 'too-large' })
    if (!put.ok) return problem('Upload failed', 'Your file did not finish uploading. Check your connection and try again.')
  } catch {
    return problem('Upload failed', 'Your file did not finish uploading. Check your connection and try again.')
  }
  deps.onPhase('reading')
  const processed = await command(deps, { operation: 'process-upload', documentId: reserved.documentId })
  if (processed.status !== 'upload-ready') return describeResult(processed, deps.trial)
  return generateFromDocument(reserved.documentId, deps)
}

/** Generate five new questions from an already-read document. */
export async function generateFromDocument(documentId: string, deps: JourneyDeps): Promise<JourneyOutcome> {
  deps.onPhase('generating')
  const result = await command(deps, { operation: 'generate', documentId,
    requestId: deps.requests.requestIdFor(documentId) })
  deps.requests.settle(documentId, result)
  const outcome = describeResult(result, deps.trial)
  return outcome.kind === 'problem' && outcome.retry === 'same-file' ? { ...outcome, documentId } : outcome
}
