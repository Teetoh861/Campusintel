// lib/ai-practice/topic-set-server.ts — Supabase-backed "Quiz me on this topic" and its verified request entry point.
// Every database call is a service-role function given the verified session id, so the database derives the student
// itself (20261117110000_campus_bot_topic_sets.sql): the topic's access, funding, limits, the notes and every charge
// are decided there. The student's own client only finds the course behind a slug and chooses the line a student
// without Campus Bot reads. The provider is Campus Bot's own (lib/campus-bot/provider.ts): the configured adapter, or a
// scripted stand-in on a developer's machine only.
import 'server-only'
import { z } from 'zod'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { notesContextFromTopic } from '@/lib/campus-bot/notes-context'
import { campusBotProvider } from '@/lib/campus-bot/provider'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent, readPlansOnSale } from '@/lib/entitlements/server'
import { createClient } from '@/lib/supabase/server'
import { acceptedGrantSources } from './entitlement'
import { fundedByTesterOffSite } from '@/lib/tester/site.cjs'
import { AI_ADMISSION_TIMEOUT_MS, AI_SETTLEMENT_TIMEOUT_MS, withAiDeadline } from './lifetime'
import { formatProviderDiagnostic } from './provider'
import { createAiPracticeServiceClient } from './supabase-env'
import { topicSetCommandSchema } from './topic-contract'
import { runTopicSet, TOPIC_SET_CHECK_TIMEOUT_MS, TOPIC_SET_WRITE_TIMEOUT_MS } from './topic-set'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import type { CampusBotNoticeKind } from '@/lib/campus-bot/contract'
import type { UsageReport } from './contract'
import type { QuestionGenerationProvider } from './provider'
import type { TopicSetResult } from './topic-contract'
import type { TopicSetBegin, TopicSetEnv, TopicSetStatus } from './topic-set'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const uuid = z.string().uuid()
const limits = z.object({ model: z.string().regex(/^claude-[a-z0-9-]{1,60}$/),
  max_input_tokens: z.number().int().min(1).max(1_000_000), max_output_tokens: z.number().int().min(1).max(1_000_000) })
const STATUSES = ['running', 'generated', 'insufficient_source', 'flagged_for_review', 'failed'] as const
const PLAIN = ['signed-out', 'disabled', 'request-conflict', 'locked', 'not-found', 'too-short', 'not-entitled',
  'pass-used', 'busy', 'undelivered-limit', 'capacity'] as const
const beginRow = z.union([
  limits.extend({ state: z.literal('started'), generation_id: uuid, reservation_seconds: z.number().int().positive(),
    check: limits.nullable(), course: z.object({ code: z.string().nullable(), title: z.string().nullable() }),
    topic: z.object({ title: z.string().min(1), number: z.number().int().positive().nullable(),
      revision: z.number().int().positive(), pinned: z.boolean() }),
    passages: z.unknown(), previous: z.array(z.string()).max(10) }),
  z.object({ state: z.literal('existing'), generation_id: uuid, status: z.enum(STATUSES) }),
  z.object({ state: z.enum(['session-limit', 'week-limit']), resets_at: z.string().min(1).nullable() }),
  z.object({ state: z.enum(PLAIN) }),
])
const finishRow = z.union([
  z.object({ state: z.literal('finished'), status: z.enum(['generated', 'insufficient_source', 'flagged_for_review',
    'failed']) }),
  z.object({ state: z.literal('already-finished'), status: z.enum(STATUSES) }),
  z.object({ state: z.literal('not-found') }),
])

/** A reservation must outlast everything the request can still do, or a slow request could be charged after its
 *  reservation was released to another. */
export function topicSetOutlasts(reservationSeconds: number, checked: boolean): boolean {
  return reservationSeconds * 1000 > AI_ADMISSION_TIMEOUT_MS + TOPIC_SET_WRITE_TIMEOUT_MS
    + (checked ? TOPIC_SET_CHECK_TIMEOUT_MS : 0) + AI_SETTLEMENT_TIMEOUT_MS
}

function usageJson(usage: UsageReport | null): Record<string, unknown> | null {
  return usage === null ? null : { ...usage }
}

/** Which line a student without Campus Bot reads: plans on sale, a free pass they can still start, or a plan. */
export async function topicNoticeKind(client: StudentClient): Promise<CampusBotNoticeKind> {
  const read = await readEntitlementForVerifiedStudent(client).catch(() => null)
  if (read === null || read.status !== 'ok') return 'plan'
  if (read.entitlement.plans_on_sale) return 'subscribe'
  return trialWording(read.entitlement).passAvailable ? 'free-pass' : 'plan'
}

export function createSupabaseTopicSetEnv(client: StudentClient, userId: string, sessionId: string,
  provider: QuestionGenerationProvider | null,
  service: () => SupabaseClient = createAiPracticeServiceClient): TopicSetEnv {
  return {
    provider,
    async begin(requestId, courseId, itemId): Promise<TopicSetBegin | null> {
      const { data, error } = await withAiDeadline(signal => service().rpc('begin_campus_bot_topic_set', {
        p_session_id: sessionId, p_request_id: requestId, p_course_id: courseId, p_item_id: itemId,
        p_accepted_sources: acceptedGrantSources() }).abortSignal(signal), AI_ADMISSION_TIMEOUT_MS)
        .catch(() => ({ data: null, error: true }))
      const parsed = beginRow.safeParse(data)
      if (error || !parsed.success) return null
      const row = parsed.data
      if (row.state === 'existing') return { state: 'existing', generationId: row.generation_id, status: row.status }
      if (row.state === 'session-limit' || row.state === 'week-limit') return { state: row.state, resetsAt: row.resets_at }
      if (row.state !== 'started') return { state: row.state }
      if (fundedByTesterOffSite(data)) return null
      const topic = { itemId, title: row.topic.title, number: row.topic.number, revision: row.topic.revision,
        pinned: row.topic.pinned }
      const notes = notesContextFromTopic(topic.title, row.passages,
        topic.number === null ? null : { itemId, number: topic.number })
      // A started set the server cannot write within its reservation is never written: the reservation lapses unused.
      if (notes === null || !topicSetOutlasts(row.reservation_seconds, row.check !== null)) return null
      return { state: 'started', generationId: row.generation_id,
        writing: { model: row.model, maxInputTokens: row.max_input_tokens, maxOutputTokens: row.max_output_tokens },
        check: row.check === null ? null : { model: row.check.model, maxInputTokens: row.check.max_input_tokens,
          maxOutputTokens: row.check.max_output_tokens },
        course: row.course, topic, notes, previousPrompts: row.previous }
    },
    async finish(generationId, settlement): Promise<TopicSetStatus | null> {
      const { data, error } = await withAiDeadline(signal => service().rpc('finish_campus_bot_topic_set', {
        p_user_id: userId, p_generation_id: generationId, p_status: settlement.status,
        p_outcome_reason: settlement.reason, p_question_set: settlement.questionSet,
        p_usage: usageJson(settlement.usage), p_check_usage: usageJson(settlement.checkUsage) })
        .abortSignal(signal), AI_SETTLEMENT_TIMEOUT_MS).catch(() => ({ data: null, error: true }))
      const parsed = finishRow.safeParse(data)
      if (error || !parsed.success || parsed.data.state === 'not-found') return null
      return parsed.data.status === 'running' ? null : parsed.data.status
    },
    notice: () => topicNoticeKind(client),
    plansOnSale: () => readPlansOnSale(client).catch(() => false),
    reportProviderProblem(code, diagnostic) {
      // Private operator signal: failure class, HTTP status, error type and request id. No student data or secret.
      console.error(`topic-set: provider failure ${formatProviderDiagnostic(code, diagnostic)}`)
    },
  }
}

/** Verify the live session and page continuity, then write one set for that student only. */
export async function runTopicSetRequest(input: unknown, response: NextResponse, pageToken: string | null):
  Promise<TopicSetResult> {
  if (!isStudentAuthEnabled()) return { status: 'disabled' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = topicSetCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    // The course behind the slug, on the student's own client. Access to it is the database's decision at admission.
    const course = await getStudentCourseBySlugForVerifiedStudent(client, parsed.data.courseSlug)
    if (course.status === 'signed-out' || course.status === 'not-found') return { status: course.status }
    if (course.status !== 'ok' && course.status !== 'repository-only') return { status: 'unavailable' }
    return await runTopicSet(createSupabaseTopicSetEnv(client, context.user.id, context.sessionId, campusBotProvider()), {
      courseId: course.course.repository.repositoryCourseId, itemId: parsed.data.itemId,
      requestId: parsed.data.requestId })
  } catch (error) {
    console.error('topic-set: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
