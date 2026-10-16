// lib/ai-practice/supabase-env.ts — Supabase-backed AiPracticeEnv and the verified request entry point.
// Reads and Storage transfers use the student's own RLS-bound client. Every database write is a service-role
// function given the verified session id, so the database derives the student itself and a student holding
// their own JWT can neither reserve, settle nor account anything directly.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { NextResponse } from 'next/server'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseByIdForVerifiedStudent } from '@/lib/courses/read-model'
import { createClient } from '@/lib/supabase/server'
import { createConfiguredProvider, isAiPracticeAvailable, readAiPracticeConfig } from './config'
import { acceptedGrantSources, effectiveAllowance } from './entitlement'
import { extractUploadText } from './extract'
import { formatProviderDiagnostic } from './provider'
import { executeAiPracticeCommand } from './student-flow'
import type { AiPracticeEnv, BeginResult, ClaimResult, DocumentRecord, GenerationRecord, ReserveResult }
  from './student-flow'
import { ACCEPTED_UPLOAD_TYPES, aiPracticeCommandSchema } from './upload-contract'
import type { AiGrantSource, AiPracticeResult, AllowanceSummary, PersonalSetView, UploadMediaType, UploadRejection }
  from './upload-contract'
import { toPersonalSetView } from './stored-set'

export const AI_PRACTICE_BUCKET = 'ai-practice-uploads'
type StudentClient = Awaited<ReturnType<typeof createClient>>
type ServiceClient = SupabaseClient

const uuid = z.string().uuid()
const reserveRow = z.union([
  z.object({ status: z.literal('created'), document_id: uuid, storage_path: z.string() }),
  z.object({ status: z.enum(['upload-limit', 'invalid-course', 'signed-out', 'not-entitled', 'allowance-exhausted',
    'allowance-expired']) }),
])
const claimRow = z.union([
  z.object({ state: z.literal('claimed'), claim_id: uuid }),
  z.object({ state: z.enum(['busy', 'settled', 'not-found', 'signed-out']) }),
])
const BEGIN_REFUSALS: ReadonlySet<string> = new Set(['busy', 'capacity', 'document-unavailable', 'request-conflict',
  'not-entitled', 'allowance-exhausted', 'allowance-expired', 'signed-out'])
const mediaTypes = Object.keys(ACCEPTED_UPLOAD_TYPES) as [UploadMediaType, ...UploadMediaType[]]
const documentRow = z.object({
  id: uuid, institutional_course_id: uuid, storage_path: z.string(), file_name: z.string(),
  media_type: z.enum(mediaTypes), status: z.enum(['awaiting_upload', 'ready', 'rejected']),
  rejection_reason: z.string().nullable(), source_text: z.string().nullable(),
})
const allowanceRow = z.object({ state: z.enum(['not-entitled', 'active', 'expired']),
  source: z.enum(['trial', 'early_access', 'test']).optional(), total: z.number().int(), used: z.number().int(),
  ends_at: z.string().optional() })
const beginRow = z.object({ state: z.string(), generation_id: uuid.optional() })
const generationRow = z.object({ id: uuid, status: z.enum(['running', 'generated', 'insufficient_source',
  'flagged_for_review', 'failed']), created_at: z.string(), question_set: z.unknown() })

/** Server-only client for the accounting RPCs; mirrors lib/auth/rate-limit.ts. */
export function createAiPracticeServiceClient(): ServiceClient {
  return createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Remaining allowance for display, read on the student's own client and filtered to accepted grant sources. */
export async function readAllowance(client: StudentClient,
  accepted: readonly AiGrantSource[] = acceptedGrantSources()): Promise<AllowanceSummary | null> {
  const { data, error } = await client.rpc('get_my_ai_allowance')
  const parsed = allowanceRow.safeParse(data)
  if (error || !parsed.success) return null
  return effectiveAllowance({ state: parsed.data.state, source: parsed.data.source ?? null, total: parsed.data.total,
    used: parsed.data.used, endsAt: parsed.data.ends_at ?? null }, accepted)
}

const RECENT_SET_LIMIT = 5

/** The student's unexpired generated sets for one course, newest first, re-validated on read. */
export async function listPersonalSetsForCourse(client: StudentClient, userId: string, courseId: string):
  Promise<PersonalSetView[]> {
  const { data, error } = await client.from('ai_practice_generations')
    .select('id,status,created_at,question_set').eq('user_id', userId).eq('institutional_course_id', courseId)
    .eq('status', 'generated').gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(RECENT_SET_LIMIT)
  if (error || !Array.isArray(data)) return []
  return data.flatMap(row => {
    const parsed = generationRow.safeParse(row)
    const view = parsed.success ? toPersonalSetView(parsed.data.id, parsed.data.created_at, parsed.data.question_set) : null
    return view ? [view] : []
  })
}

export function createSupabaseAiPracticeEnv(client: StudentClient, userId: string, sessionId: string,
  service: () => ServiceClient = createAiPracticeServiceClient): AiPracticeEnv {
  const config = readAiPracticeConfig()
  const accepted = acceptedGrantSources()
  return {
    userId,
    readCourse: courseId => getStudentCourseByIdForVerifiedStudent(client, courseId),
    async reserveDocument(courseId, fileName, mediaType, bytes): Promise<ReserveResult | null> {
      const { data, error } = await service().rpc('create_ai_practice_document', { p_session_id: sessionId,
        p_institutional_course_id: courseId, p_file_name: fileName, p_media_type: mediaType, p_declared_bytes: bytes,
        p_accepted_sources: accepted })
      const parsed = reserveRow.safeParse(data)
      if (error || !parsed.success) return null
      return parsed.data.status === 'created'
        ? { status: 'created', documentId: parsed.data.document_id, storagePath: parsed.data.storage_path }
        : { status: parsed.data.status }
    },
    async signUpload(storagePath) {
      const { data, error } = await client.storage.from(AI_PRACTICE_BUCKET).createSignedUploadUrl(storagePath)
      return error || !data ? null : data.signedUrl
    },
    async getDocument(documentId): Promise<DocumentRecord | null | 'error'> {
      const { data, error } = await client.from('ai_practice_documents')
        .select('id,institutional_course_id,storage_path,file_name,media_type,status,rejection_reason,source_text')
        .eq('id', documentId).eq('user_id', userId).maybeSingle()
      if (error) return 'error'
      if (data === null) return null
      const row = documentRow.safeParse(data)
      if (!row.success) return 'error'
      return { id: row.data.id, institutionalCourseId: row.data.institutional_course_id,
        storagePath: row.data.storage_path, fileName: row.data.file_name, mediaType: row.data.media_type,
        status: row.data.status, rejectionReason: row.data.rejection_reason as UploadRejection | null,
        sourceText: row.data.source_text }
    },
    async downloadUpload(storagePath) {
      const { data, error } = await client.storage.from(AI_PRACTICE_BUCKET).download(storagePath, {}, { cache: 'no-store' })
      if (error) {
        const status = 'status' in error && typeof error.status === 'number' ? error.status : 0
        return status === 400 || status === 404 ? 'missing' : 'error'
      }
      return new Uint8Array(await data.arrayBuffer())
    },
    async claimExtraction(documentId): Promise<ClaimResult | null> {
      const { data, error } = await service().rpc('claim_ai_practice_extraction',
        { p_session_id: sessionId, p_document_id: documentId })
      const parsed = claimRow.safeParse(data)
      if (error || !parsed.success) return null
      return parsed.data.state === 'claimed' ? { state: 'claimed', claimId: parsed.data.claim_id } : { state: parsed.data.state }
    },
    async releaseExtraction(documentId, claimId) {
      // Best effort: an unreleased claim simply expires with its lease.
      await service().rpc('release_ai_practice_extraction', { p_user_id: userId, p_document_id: documentId,
        p_claim_id: claimId })
    },
    async settleDocument(documentId, claimId, result) {
      const { data, error } = await service().rpc('settle_ai_practice_document', 'rejection' in result
        ? { p_session_id: sessionId, p_document_id: documentId, p_claim_id: claimId, p_rejection_reason: result.rejection,
          p_source_text: null, p_source_sha256: null, p_word_count: null }
        : { p_session_id: sessionId, p_document_id: documentId, p_claim_id: claimId, p_rejection_reason: null,
          p_source_text: result.text, p_source_sha256: result.sha256, p_word_count: result.wordCount })
      return !error && data === true
    },
    async removeUpload(documentId, storagePath) {
      // Best effort: the scheduled cleanup removes anything left behind.
      const removed = await client.storage.from(AI_PRACTICE_BUCKET).remove([storagePath]).catch(() => null)
      if (removed && !removed.error) {
        await service().rpc('note_ai_practice_upload_removed', { p_user_id: userId, p_document_id: documentId })
      }
    },
    allowance: () => readAllowance(client, accepted),
    async beginGeneration(requestId, documentId): Promise<BeginResult | null> {
      const { data, error } = await service().rpc('begin_ai_practice_generation', {
        p_session_id: sessionId, p_request_id: requestId, p_document_id: documentId, p_accepted_sources: accepted })
      const parsed = beginRow.safeParse(data)
      if (error || !parsed.success) return null
      const { state, generation_id: generationId } = parsed.data
      if (state === 'started' || state === 'existing') return generationId ? { state, generationId } : null
      if (BEGIN_REFUSALS.has(state)) return { state } as BeginResult
      return null
    },
    async finishGeneration(generationId, status, reason, questionSet, usage) {
      const { data, error } = await service().rpc('finish_ai_practice_generation', {
        p_user_id: userId, p_generation_id: generationId, p_status: status, p_outcome_reason: reason,
        p_question_set: questionSet, p_usage: usage })
      return !error && z.object({ state: z.literal('finished') }).safeParse(data).success
    },
    async getGeneration(generationId): Promise<GenerationRecord | null> {
      const { data, error } = await client.from('ai_practice_generations')
        .select('id,status,created_at,question_set').eq('id', generationId).eq('user_id', userId).maybeSingle()
      const row = generationRow.safeParse(data)
      if (error || !row.success) return null
      return { id: row.data.id, status: row.data.status, createdAt: row.data.created_at, questionSet: row.data.question_set }
    },
    extract: extractUploadText,
    provider: createConfiguredProvider(config),
    timeoutMs: config.status === 'enabled' ? config.timeoutMs : 0,
    reportProviderProblem(code, diagnostic) {
      // Private operator signal: failure class, HTTP status, error type and request id. No student data or secret.
      console.error(`ai-practice: provider failure ${formatProviderDiagnostic(code, diagnostic)}`)
    },
  }
}

/** Verify the live session and page continuity, then run one command for that student only. */
export async function runAiPracticeRequest(input: unknown, response: NextResponse, pageToken: string | null):
  Promise<AiPracticeResult> {
  // Uploads are refused unless generation can actually run: no slot is reserved that could never be used.
  if (!isStudentAuthEnabled() || !isAiPracticeAvailable()) return { status: 'disabled' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = aiPracticeCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    return await executeAiPracticeCommand(createSupabaseAiPracticeEnv(client, context.user.id, context.sessionId),
      parsed.data)
  } catch (error) {
    console.error('ai-practice: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
