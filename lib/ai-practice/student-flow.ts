// lib/ai-practice/student-flow.ts — The upload-to-practice journey over an injected, already-authorized environment.
// Callers verify the session first; everything here acts only for env.userId and never trusts client identity.
import 'server-only'
import { getStudentCourseUnavailability, hasActiveCourseOffering } from '@/lib/courses/read-model'
import type { StudentCourse, StudentCourseByIdResult } from '@/lib/courses/read-model'
import { AI_PRACTICE_LIMITS } from './contract'
import type { GenerationOutcome } from './contract'
import type { ExtractionResult } from './extract'
import { EMPTY_PROVIDER_DIAGNOSTIC } from './provider'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from './provider'
import { generatePracticeSet } from './service'
import { prepareSource } from './source'
import { toPersonalSetView, toStoredSet } from './stored-set'
import { mediaTypeForFileName } from './upload-contract'
import type { AiPracticeCommand, AiPracticeResult, AllowanceSummary, UploadMediaType, UploadRejection }
  from './upload-contract'

export type DocumentRecord = {
  id: string
  institutionalCourseId: string
  storagePath: string
  fileName: string
  mediaType: UploadMediaType
  status: 'awaiting_upload' | 'ready' | 'rejected'
  rejectionReason: UploadRejection | null
  sourceText: string | null
}

export type GenerationRecord = {
  id: string
  status: 'running' | 'generated' | 'insufficient_source' | 'flagged_for_review' | 'failed'
  createdAt: string
  questionSet: unknown
}

export type BeginResult =
  | { state: 'started'; generationId: string }
  | { state: 'existing'; generationId: string }
  | { state: 'busy' | 'capacity' | 'document-unavailable' | 'request-conflict' | 'not-entitled' | 'allowance-exhausted'
      | 'allowance-expired' | 'signed-out' }

export type ReserveResult =
  | { status: 'created'; documentId: string; storagePath: string }
  | { status: 'upload-limit' | 'invalid-course' | 'signed-out' | 'not-entitled' | 'allowance-exhausted' | 'allowance-expired' }

/** The extraction lease: only the holder of claimId may settle the document. */
export type ClaimResult = { state: 'claimed'; claimId: string } | { state: 'busy' | 'settled' | 'not-found' | 'signed-out' }

export type SettleResult = { rejection: UploadRejection } | { text: string; sha256: string; wordCount: number }

export type FinishStatus = Exclude<GenerationRecord['status'], 'running'>

/**
 * Everything the journey touches, bound to one verified student and session. Supabase backs it in production,
 * where every write is a service-role function that re-derives the student from the session id.
 */
export type AiPracticeEnv = {
  userId: string
  readCourse(courseId: string): Promise<StudentCourseByIdResult>
  reserveDocument(courseId: string, fileName: string, mediaType: UploadMediaType, bytes: number):
    Promise<ReserveResult | null>
  signUpload(storagePath: string): Promise<string | null>
  getDocument(documentId: string): Promise<DocumentRecord | null | 'error'>
  claimExtraction(documentId: string): Promise<ClaimResult | null>
  releaseExtraction(documentId: string, claimId: string): Promise<void>
  downloadUpload(storagePath: string): Promise<Uint8Array | 'missing' | 'error'>
  settleDocument(documentId: string, claimId: string, result: SettleResult): Promise<boolean>
  removeUpload(documentId: string, storagePath: string): Promise<void>
  allowance(): Promise<AllowanceSummary | null>
  beginGeneration(requestId: string, documentId: string): Promise<BeginResult | null>
  finishGeneration(generationId: string, status: FinishStatus, reason: string | null,
    questionSet: Record<string, unknown> | null, usage: Record<string, unknown> | null): Promise<boolean>
  getGeneration(generationId: string): Promise<GenerationRecord | null>
  extract(bytes: Uint8Array, mediaType: UploadMediaType): Promise<ExtractionResult>
  provider: QuestionGenerationProvider | null
  timeoutMs: number
  /** Private operator diagnostics for every provider failure; never student-visible. */
  reportProviderProblem(code: ProviderErrorCode, diagnostic: ProviderDiagnostic): void
}

/** PRD 4.3: AI practice requires an active offering whose content is honestly not built. */
export function isAiPracticeEligible(course: StudentCourse): boolean {
  return hasActiveCourseOffering(course) && getStudentCourseUnavailability(course) === 'missing'
}

type CourseCheck = { status: 'ok'; course: StudentCourse } | { status: 'signed-out' | 'not-found' | 'unavailable' | 'not-eligible' }

async function eligibleCourse(env: AiPracticeEnv, courseId: string): Promise<CourseCheck> {
  const result = await env.readCourse(courseId)
  if (result.status === 'signed-out' || result.status === 'not-found') return { status: result.status }
  if (result.status !== 'ok') return { status: 'unavailable' }
  return isAiPracticeEligible(result.course) ? result : { status: 'not-eligible' }
}

function allowanceBlock(allowance: AllowanceSummary | null): AiPracticeResult | null {
  // No accepted grant: nothing could ever be generated, so no upload slot is reserved either.
  if (allowance?.state === 'not-entitled') return { status: 'not-entitled' }
  if (allowance?.state === 'expired') return { status: 'allowance-expired', allowance }
  if (allowance && allowance.state === 'active' && allowance.total !== null && allowance.used >= allowance.total) {
    return { status: 'allowance-exhausted', allowance }
  }
  return null
}

async function reserveUpload(env: AiPracticeEnv, command: Extract<AiPracticeCommand, { operation: 'reserve-upload' }>):
  Promise<AiPracticeResult> {
  if (mediaTypeForFileName(command.fileName) !== command.mediaType) return { status: 'invalid-request' }
  const course = await eligibleCourse(env, command.courseId)
  if (course.status !== 'ok') return { status: course.status }
  const blocked = allowanceBlock(await env.allowance())
  if (blocked) return blocked
  const reserved = await env.reserveDocument(command.courseId, command.fileName, command.mediaType, command.byteSize)
  if (reserved === null) return { status: 'unavailable' }
  if (reserved.status === 'created') {
    const uploadUrl = await env.signUpload(reserved.storagePath)
    return uploadUrl === null ? { status: 'unavailable' } : { status: 'upload-reserved', documentId: reserved.documentId, uploadUrl }
  }
  // The database re-checks the grant under the account lock; a stale display read cannot open a slot.
  if (reserved.status === 'allowance-exhausted' || reserved.status === 'allowance-expired') {
    return { status: reserved.status, allowance: await env.allowance() }
  }
  if (reserved.status === 'invalid-course') return { status: 'not-found' }
  return { status: reserved.status }
}

function documentState(document: DocumentRecord): AiPracticeResult | null {
  if (document.status === 'ready') return { status: 'upload-ready', documentId: document.id }
  if (document.status === 'rejected') return { status: 'upload-rejected', reason: document.rejectionReason ?? 'corrupt' }
  return null
}

/** Whatever the document became after another request settled it. */
async function currentState(env: AiPracticeEnv, documentId: string): Promise<AiPracticeResult> {
  const current = await env.getDocument(documentId)
  return current !== null && current !== 'error' ? documentState(current) ?? { status: 'unavailable' } : { status: 'unavailable' }
}

/** Download, extract and settle under a held claim. Returns null when the claim was lost before settling. */
async function extractClaimed(env: AiPracticeEnv, document: DocumentRecord, claimId: string):
  Promise<{ settled: SettleResult } | 'unavailable' | null> {
  const bytes = await env.downloadUpload(document.storagePath)
  // A Storage outage never permanently rejects the file; the claim is released for a retry.
  if (bytes === 'error') return 'unavailable'
  let result: SettleResult
  if (bytes === 'missing') result = { rejection: 'missing-upload' }
  else {
    const extracted = await env.extract(bytes, document.mediaType)
    // A saturated or missing parser is ours, not the file's: release the claim for a retry.
    if (extracted.status === 'unavailable') return 'unavailable'
    result = extracted.status === 'rejected' ? { rejection: extracted.reason } : sourceOutcome(extracted.text)
  }
  return await env.settleDocument(document.id, claimId, result) ? { settled: result } : null
}

function sourceOutcome(text: string): SettleResult {
  const prepared = prepareSource(text)
  if (prepared.status === 'ok') {
    return { text: prepared.source.text, sha256: prepared.source.sha256, wordCount: prepared.source.wordCount }
  }
  return { rejection: prepared.status === 'too-large' ? 'too-much-text' : prepared.status }
}

async function processUpload(env: AiPracticeEnv, documentId: string): Promise<AiPracticeResult> {
  const document = await env.getDocument(documentId)
  if (document === 'error') return { status: 'unavailable' }
  if (document === null) return { status: 'not-found' }
  const course = await eligibleCourse(env, document.institutionalCourseId)
  if (course.status !== 'ok') return { status: course.status }
  const settled = documentState(document)
  if (settled) return settled
  // Claim before any expensive work: concurrent requests for one upload never extract it twice.
  const claim = await env.claimExtraction(document.id)
  if (claim === null) return { status: 'unavailable' }
  if (claim.state === 'settled') return currentState(env, documentId)
  if (claim.state !== 'claimed') return { status: claim.state }
  let outcome: Awaited<ReturnType<typeof extractClaimed>> = 'unavailable'
  try {
    outcome = await extractClaimed(env, document, claim.claimId)
  } finally {
    // A settled claim is already cleared; anything else lets go now instead of waiting out the lease.
    if (outcome === 'unavailable') await env.releaseExtraction(document.id, claim.claimId)
  }
  if (outcome === 'unavailable') return { status: 'unavailable' }
  if (outcome === null) return currentState(env, documentId)
  await env.removeUpload(document.id, document.storagePath)
  return 'rejection' in outcome.settled
    ? { status: 'upload-rejected', reason: outcome.settled.rejection }
    : { status: 'upload-ready', documentId: document.id }
}

const FINISH_STATUS: Record<Exclude<GenerationOutcome['status'], 'generated'>, FinishStatus> = {
  'insufficient-source': 'insufficient_source',
  'flagged-for-review': 'flagged_for_review',
  'failed': 'failed',
}

async function storedResult(env: AiPracticeEnv, generationId: string): Promise<AiPracticeResult> {
  const record = await env.getGeneration(generationId)
  if (record === null) return { status: 'unavailable' }
  const allowance = await env.allowance()
  if (record.status === 'running') return { status: 'busy' }
  if (record.status === 'generated') {
    const set = toPersonalSetView(record.id, record.createdAt, record.questionSet)
    return set ? { status: 'generated', set, allowance } : { status: 'unavailable' }
  }
  if (record.status === 'insufficient_source') return { status: 'insufficient-source', allowance }
  if (record.status === 'flagged_for_review') return { status: 'flagged-for-review', allowance }
  return { status: 'generation-failed', allowance }
}

async function generate(env: AiPracticeEnv, command: Extract<AiPracticeCommand, { operation: 'generate' }>):
  Promise<AiPracticeResult> {
  const document = await env.getDocument(command.documentId)
  if (document === 'error') return { status: 'unavailable' }
  if (document === null) return { status: 'not-found' }
  const course = await eligibleCourse(env, document.institutionalCourseId)
  if (course.status !== 'ok') return { status: course.status }
  if (document.status !== 'ready' || document.sourceText === null) {
    return documentState(document) ?? { status: 'invalid-request' }
  }
  // Without a provider nothing is reserved: an outage never touches the allowance.
  if (!env.provider) return { status: 'unavailable' }
  const begun = await env.beginGeneration(command.requestId, document.id)
  if (begun === null) return { status: 'unavailable' }
  if (begun.state === 'existing') return storedResult(env, begun.generationId)
  if (begun.state === 'request-conflict') return { status: 'invalid-request' }
  if (begun.state === 'document-unavailable') return { status: 'not-found' }
  if (begun.state === 'busy' || begun.state === 'capacity' || begun.state === 'not-entitled' ||
    begun.state === 'signed-out') return { status: begun.state }
  if (begun.state !== 'started') return { status: begun.state, allowance: await env.allowance() }

  const outcome = await generatePracticeSet({
    course: { courseId: course.course.institutionalCourseId, code: course.course.code, title: course.course.title },
    source: { documentId: document.id, fileName: document.fileName, extractedText: document.sourceText },
    questionCount: AI_PRACTICE_LIMITS.questionsPerRequest,
  }, { provider: env.provider, timeoutMs: env.timeoutMs })
  if (outcome.status === 'failed' && outcome.providerError) {
    env.reportProviderProblem(outcome.providerError, outcome.providerDiagnostic ?? EMPTY_PROVIDER_DIAGNOSTIC)
  }
  const usage = outcome.usage ? { ...outcome.usage } : null
  if (outcome.status === 'generated') {
    await env.finishGeneration(begun.generationId, 'generated', null, toStoredSet(outcome.set), usage)
  } else {
    await env.finishGeneration(begun.generationId, FINISH_STATUS[outcome.status], outcome.reason, null, usage)
  }
  // The student sees what the ledger recorded, so a set is never shown unless it was accounted as delivered.
  return storedResult(env, begun.generationId)
}

/** Execute one validated command for the verified student bound into env. */
export async function executeAiPracticeCommand(env: AiPracticeEnv, command: AiPracticeCommand): Promise<AiPracticeResult> {
  if (command.operation === 'reserve-upload') return reserveUpload(env, command)
  if (command.operation === 'process-upload') return processUpload(env, command.documentId)
  return generate(env, command)
}
