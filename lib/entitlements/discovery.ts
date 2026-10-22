// lib/entitlements/discovery.ts — Server entry points for Discovery Pass previews.
// The course comes from the central read model on the student's own cookie-bound client; the preview functions are
// service-role only and take the verified session id, so the database derives the student, applies the pass window on
// its own clock and returns only the pinned slice (20261021100000_discovery_pass.sql). Only an actively offered
// institutional course has previews, checked here and again in the database. The exam length is the course's own CBT
// duration from the server's quiz configuration; the browser can never supply or change it.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent, hasActiveCourseOffering } from '@/lib/courses/read-model'
import { getCourseByContentKey } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { createClient } from '@/lib/supabase/server'
import { discoveryCommandSchema, discoveryPreviewSchema, sampleAnswers } from './discovery-contract'
import type { NextResponse } from 'next/server'
import type { DiscoveryKind, DiscoveryResult, SheetDelta } from './discovery-contract'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const timestamp = z.string().min(1)
const previewRow = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), now: timestamp, ends_at: timestamp, preview: discoveryPreviewSchema }),
  z.object({ state: z.literal('available'), now: timestamp, ends_at: timestamp,
    // Strict: a topic that carries anything beyond its title fails the whole answer closed.
    topics: z.array(z.object({ item_id: z.string().uuid(), title: z.string() }).strict()).nullable() }),
  z.object({ state: z.literal('used-elsewhere'), ends_at: timestamp, content_key: z.string().nullable() }),
  z.object({ state: z.literal('not-enough-time'), now: timestamp, ends_at: timestamp }),
  z.object({ state: z.enum(['saved', 'stale', 'too-many-tabs']), now: timestamp, deadline_at: timestamp,
    revision: z.number().int().nonnegative(), answers: sampleAnswers }),
  z.object({ state: z.enum(['signed-out', 'invalid-course', 'not-offered', 'invalid-request', 'free-course',
    'full-access', 'no-pass', 'expired', 'nothing-to-preview', 'not-opened']) }),
])
// The preview functions raise this for a malformed request, such as an answer to a question outside the sample.
const INVALID_REQUEST_CODE = '22023'

function rpcAnswer(data: unknown, error: { code?: string } | null): unknown {
  if (error === null) return data
  return error.code === INVALID_REQUEST_CODE ? { state: 'invalid-request' } : null
}

/** What opening pins: the exam with its server-side duration, or the one topic the student chose. */
export type DiscoveryOpen = { kind: 'cbt'; examSeconds: number } | { kind: 'study_guide'; itemId: string }

export type DiscoveryEnv = {
  /** examSeconds lets the database say whether the whole exam still fits before the pass ends. */
  read(courseId: string, kind: DiscoveryKind, examSeconds: number | null): Promise<unknown>
  open(courseId: string, target: DiscoveryOpen): Promise<unknown>
  /** One tab's changed questions over the revision it last received; an empty delta only reads clock and sheet. */
  save(courseId: string, delta: SheetDelta): Promise<unknown>
  submit(courseId: string, delta: SheetDelta): Promise<unknown>
}

/** Map the database answer to the client contract. Anything missing or malformed is `unavailable`. */
export function discoveryResultFrom(data: unknown): DiscoveryResult {
  const parsed = previewRow.safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }
  const row = parsed.data
  if (row.state === 'ready') return { status: 'ready', now: row.now, endsAt: row.ends_at, preview: row.preview }
  if (row.state === 'available') return { status: 'available', now: row.now, endsAt: row.ends_at, topics: row.topics }
  if (row.state === 'not-enough-time') return { status: 'not-enough-time', now: row.now, endsAt: row.ends_at }
  if (row.state === 'saved' || row.state === 'stale' || row.state === 'too-many-tabs') {
    return { status: row.state, now: row.now, deadlineAt: row.deadline_at, revision: row.revision, answers: row.answers }
  }
  if (row.state === 'used-elsewhere') {
    const course = row.content_key === null ? undefined : getCourseByContentKey(row.content_key)
    return { status: 'used-elsewhere', endsAt: row.ends_at, courseCode: course?.code ?? null,
      courseSlug: course?.slug ?? null }
  }
  return { status: row.state === 'invalid-course' || row.state === 'not-offered' ? 'not-found' : row.state }
}

function createSupabaseDiscoveryEnv(sessionId: string): DiscoveryEnv {
  // Server-only client for the preview RPCs; mirrors lib/entitlements/server.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    async read(courseId, kind, examSeconds) {
      const { data, error } = await service.rpc('discovery_preview', { p_session_id: sessionId, p_course_id: courseId,
        p_kind: kind, p_claim: false, p_exam_seconds: kind === 'cbt' ? examSeconds : null })
      return rpcAnswer(data, error)
    },
    async open(courseId, target) {
      const { data, error } = await service.rpc('discovery_preview', { p_session_id: sessionId, p_course_id: courseId,
        p_kind: target.kind, p_claim: true, p_item_id: target.kind === 'study_guide' ? target.itemId : null,
        p_exam_seconds: target.kind === 'cbt' ? target.examSeconds : null })
      return rpcAnswer(data, error)
    },
    async save(courseId, delta) {
      const { data, error } = await service.rpc('save_discovery_cbt', { p_session_id: sessionId, p_course_id: courseId,
        p_tab: delta.tab, p_sequence: delta.sequence, p_base_revision: delta.baseRevision, p_changes: delta.changes })
      return rpcAnswer(data, error)
    },
    async submit(courseId, delta) {
      const { data, error } = await service.rpc('submit_discovery_cbt', { p_session_id: sessionId, p_course_id: courseId,
        p_tab: delta.tab, p_sequence: delta.sequence, p_base_revision: delta.baseRevision, p_changes: delta.changes })
      return rpcAnswer(data, error)
    },
  }
}

type CourseIdentity = { status: 'ok'; courseId: string; slug: string }
  | { status: 'signed-out' | 'not-found' | 'unavailable' }

/**
 * The repository course behind a slug, resolved on the student's own client. Only an institutional course offered in an
 * active department, level and semester has previews; repository-only and retired identities are not offered.
 */
async function courseFor(client: StudentClient, slug: string): Promise<CourseIdentity> {
  const result = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (result.status === 'ok') {
    if (!hasActiveCourseOffering(result.course)) return { status: 'not-found' }
    return { status: 'ok', courseId: result.course.repository.repositoryCourseId, slug: result.course.repository.route.slug }
  }
  if (result.status === 'repository-only') return { status: 'not-found' }
  return { status: result.status === 'invariant-failure' ? 'unavailable' : result.status }
}

/** The course's own CBT duration, exactly as a regular attempt is timed. Null when the course has no CBT policy. */
export function examSecondsFor(slug: string): number | null {
  const minutes = getQuizConfigurationByCourseSlug(slug)?.quizDurationMinutes
  return minutes !== undefined && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null
}

/** Read a preview without opening one, for the preview page. Never spends anything. */
export async function readDiscoveryPreview(sessionId: string, courseId: string, kind: DiscoveryKind,
  examSeconds: number | null, env: DiscoveryEnv = createSupabaseDiscoveryEnv(sessionId)): Promise<DiscoveryResult> {
  try { return discoveryResultFrom(await env.read(courseId, kind, examSeconds)) }
  catch { return { status: 'unavailable' } }
}

/** Verify the live session and page continuity, then open or grade one preview for that student only. */
export async function runDiscoveryRequest(input: unknown, response: NextResponse, pageToken: string | null):
  Promise<DiscoveryResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = discoveryCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const command = parsed.data
    const course = await courseFor(client, command.courseSlug)
    if (course.status !== 'ok') return { status: course.status }
    const env = createSupabaseDiscoveryEnv(context.sessionId)
    if (command.action === 'save-answers' || command.action === 'submit-exam') {
      const { action, courseSlug: _slug, ...delta } = command
      const call = action === 'save-answers' ? env.save : env.submit
      return discoveryResultFrom(await call(course.courseId, delta))
    }
    if (command.action === 'sync-exam') {
      // A delta with nothing in it: the database answers with its clock, the deadline and the sheet that stands.
      return discoveryResultFrom(await env.save(course.courseId, { tab: command.tab, sequence: 0, baseRevision: 0, changes: {} }))
    }
    if (command.action === 'open-topic') {
      return discoveryResultFrom(await env.open(course.courseId, { kind: 'study_guide', itemId: command.itemId }))
    }
    const examSeconds = examSecondsFor(course.slug)
    if (examSeconds === null) return { status: 'nothing-to-preview' }
    return discoveryResultFrom(await env.open(course.courseId, { kind: 'cbt', examSeconds }))
  } catch (error) {
    console.error('discovery: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
