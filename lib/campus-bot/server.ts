// lib/campus-bot/server.ts — Supabase-backed Explain and Ask Campus Bot, and the verified request entry point.
// Every database call is a service-role function given the verified session id, so the database derives the student
// itself (20261117100000_campus_bot_explain_ask.sql): the attempt check, course access, funding, limits, the notes and
// every charge are decided there. The student's own client is used only to find the course behind a slug and to
// choose the line a student without Campus Bot reads.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AI_ADMISSION_TIMEOUT_MS, AI_SETTLEMENT_TIMEOUT_MS, withAiDeadline } from '@/lib/ai-practice/lifetime'
import { formatProviderDiagnostic } from '@/lib/ai-practice/provider'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent, readPlansOnSale } from '@/lib/entitlements/server'
import { createClient } from '@/lib/supabase/server'
import { askCampusBot, CHAT_TIMEOUT_MS } from './ask'
import { campusBotCommandSchema } from './contract'
import { explainQuestion, EXPLAIN_CHECK_TIMEOUT_MS, EXPLAIN_WRITE_TIMEOUT_MS } from './explain'
import { notesContextFromSearch, notesContextFromTopic } from './notes-context'
import { campusBotProvider } from './provider'
import type { NextResponse } from 'next/server'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { AskBegin, AskEnv, AskSettlement } from './ask'
import type { AskResult, CampusBotNoticeKind, ExplainResult } from './contract'
import type { ExplainBegin, ExplainEnv, ExplainSettlement, SavedExplanation } from './explain'

type StudentClient = Awaited<ReturnType<typeof createClient>>
type ServiceClient = SupabaseClient

const uuid = z.string().uuid()
const providerModel = z.string().regex(/^claude-[a-z0-9-]{1,60}$/)
const limits = z.object({ model: providerModel, max_output_tokens: z.number().int().min(1).max(1_000_000) })
const courseLabel = z.object({ code: z.string().nullable(), title: z.string().nullable() })
const topic = z.object({ item_id: uuid, number: z.number().int().positive(), title: z.string().min(1) }).nullable()
const saved = z.object({ outcome: z.enum(['explained', 'not-covered', 'check-failed']), body: z.string().nullable(),
  topic })
const PLAIN_EXPLAIN = ['signed-out', 'disabled', 'not-found', 'not-answered', 'exam-open', 'locked', 'not-entitled',
  'busy', 'undelivered-limit', 'pass-limit', 'capacity'] as const
const PLAIN_ASK = ['signed-out', 'disabled', 'not-found', 'exam-open', 'locked', 'not-entitled', 'busy',
  'undelivered-limit', 'pass-limit', 'capacity'] as const
const limitRow = z.object({ state: z.enum(['session-limit', 'week-limit']), resets_at: z.string().min(1).nullable() })

const explainBegin = z.union([
  limits.extend({ state: z.literal('started'), reply_id: uuid, reservation_seconds: z.number().int().positive(),
    check: limits.nullable(), course: courseLabel, passages: z.unknown(),
    question: z.object({ prompt: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(8),
      correct_option: z.number().int().min(0).max(7), chosen_option: z.number().int().min(0).max(7).nullable(),
      explanation: z.string().nullable() }) }),
  saved.extend({ state: z.literal('saved') }),
  limitRow,
  z.object({ state: z.enum(PLAIN_EXPLAIN) }),
])
const explainFinish = z.union([
  saved.extend({ state: z.literal('finished') }),
  z.object({ state: z.literal('finished'), outcome: z.literal('failed') }),
  z.object({ state: z.enum(['already-finished', 'not-found']) }),
])
const chatReply = z.object({ text: z.string().min(1).max(4_000), in_notes: z.boolean() }).strict()
const askBegin = z.union([
  limits.extend({ state: z.literal('started'), reply_id: uuid, reservation_seconds: z.number().int().positive(),
    course: courseLabel, topic: z.object({ title: z.string().min(1) }), passages: z.unknown() }),
  z.object({ state: z.literal('answered'), reply: chatReply.nullable() }),
  limitRow,
  z.object({ state: z.enum(PLAIN_ASK) }),
])
const askFinish = z.object({ state: z.literal('finished'), outcome: z.enum(['answered', 'failed']) })

function savedFrom(row: z.infer<typeof saved>): SavedExplanation | null {
  const link = row.topic === null ? null : { number: row.topic.number, title: row.topic.title }
  if (row.outcome === 'not-covered') return { outcome: 'not-covered' }
  if (row.outcome === 'check-failed') return { outcome: 'check-failed', topic: link }
  return row.body === null || row.body.trim() === '' ? null : { outcome: 'explained', body: row.body, topic: link }
}

function usageJson(usage: UsageReport | null): Record<string, unknown> | null {
  return usage === null ? null : { ...usage }
}

function createCampusBotServiceClient(): ServiceClient {
  // Server-only client for the Campus Bot RPCs; mirrors lib/practice/server.ts.
  return createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

type Shared = Pick<ExplainEnv, 'provider' | 'notice' | 'plansOnSale' | 'reportProviderProblem'>

function sharedEnv(client: StudentClient, provider: QuestionGenerationProvider | null): Shared {
  return {
    provider,
    async notice(): Promise<CampusBotNoticeKind> {
      // Plans on sale: subscribe. A free pass this student can still start: the pass. Otherwise, or unread: a plan.
      const read = await readEntitlementForVerifiedStudent(client).catch(() => null)
      if (read === null || read.status !== 'ok') return 'plan'
      if (read.entitlement.plans_on_sale) return 'subscribe'
      return trialWording(read.entitlement).passAvailable ? 'free-pass' : 'plan'
    },
    plansOnSale: () => readPlansOnSale(client).catch(() => false),
    reportProviderProblem(code: ProviderErrorCode, diagnostic: ProviderDiagnostic) {
      // Private operator signal: failure class, HTTP status, error type and request id. No student data or secret.
      console.error(`campus-bot: provider failure ${formatProviderDiagnostic(code, diagnostic)}`)
    },
  }
}

// A reservation must outlast everything the request can still do, or a slow request could be charged after its
// reservation was released to another.
function outlasts(reservationSeconds: number, callsMs: number): boolean {
  return reservationSeconds * 1000 > AI_ADMISSION_TIMEOUT_MS + callsMs + AI_SETTLEMENT_TIMEOUT_MS
}

export function createSupabaseExplainEnv(client: StudentClient, userId: string, sessionId: string,
  provider: QuestionGenerationProvider | null, service: () => ServiceClient = createCampusBotServiceClient): ExplainEnv {
  return {
    ...sharedEnv(client, provider),
    async begin(attemptId, questionId, generate): Promise<ExplainBegin | null> {
      const { data, error } = await withAiDeadline(signal => service().rpc('begin_campus_bot_explanation', {
        p_session_id: sessionId, p_attempt_id: attemptId, p_question_id: questionId, p_generate: generate })
        .abortSignal(signal), AI_ADMISSION_TIMEOUT_MS)
      const parsed = explainBegin.safeParse(data)
      if (error || !parsed.success) return null
      const row = parsed.data
      if (row.state === 'saved') {
        const explanation = savedFrom(row)
        return explanation === null ? null : { state: 'saved', saved: explanation }
      }
      if (row.state === 'session-limit' || row.state === 'week-limit') return { state: row.state, resetsAt: row.resets_at }
      if (row.state !== 'started') return { state: row.state }
      const notes = notesContextFromSearch(row.passages)
      if (notes === null || row.question.correct_option >= row.question.options.length
          || !outlasts(row.reservation_seconds, EXPLAIN_WRITE_TIMEOUT_MS + EXPLAIN_CHECK_TIMEOUT_MS)) return null
      return { state: 'started', replyId: row.reply_id, limits: { model: row.model, maxOutputTokens: row.max_output_tokens },
        check: row.check === null ? null : { model: row.check.model, maxOutputTokens: row.check.max_output_tokens },
        course: row.course, notes, question: { prompt: row.question.prompt, options: row.question.options,
          correctOption: row.question.correct_option, chosenOption: row.question.chosen_option,
          officialExplanation: row.question.explanation } }
    },
    async finish(replyId, settlement: ExplainSettlement): Promise<SavedExplanation | 'failed' | null> {
      const { data, error } = await withAiDeadline(signal => service().rpc('finish_campus_bot_explanation', {
        p_user_id: userId, p_reply_id: replyId, p_outcome: settlement.outcome,
        p_body: settlement.outcome === 'explained' ? settlement.body : null,
        p_topic_item_id: settlement.outcome === 'explained' || settlement.outcome === 'check-failed'
          ? settlement.topicItemId : null,
        p_usage: usageJson(settlement.usage),
        p_check_usage: settlement.outcome === 'not-covered' ? null : usageJson(settlement.checkUsage) })
        .abortSignal(signal), AI_SETTLEMENT_TIMEOUT_MS).catch(() => ({ data: null, error: true }))
      const parsed = explainFinish.safeParse(data)
      if (error || !parsed.success || parsed.data.state !== 'finished') return null
      return parsed.data.outcome === 'failed' ? 'failed' : savedFrom(parsed.data)
    },
  }
}

export function createSupabaseAskEnv(client: StudentClient, userId: string, sessionId: string,
  provider: QuestionGenerationProvider | null, service: () => ServiceClient = createCampusBotServiceClient): AskEnv {
  return {
    ...sharedEnv(client, provider),
    async begin(requestId, courseId, itemId, generate): Promise<AskBegin | null> {
      const { data, error } = await withAiDeadline(signal => service().rpc('begin_campus_bot_chat', {
        p_session_id: sessionId, p_request_id: requestId, p_course_id: courseId, p_item_id: itemId,
        p_generate: generate }).abortSignal(signal), AI_ADMISSION_TIMEOUT_MS)
      const parsed = askBegin.safeParse(data)
      if (error || !parsed.success) return null
      const row = parsed.data
      if (row.state === 'answered') {
        return { state: 'answered', reply: row.reply === null ? null : { text: row.reply.text, inNotes: row.reply.in_notes } }
      }
      if (row.state === 'session-limit' || row.state === 'week-limit') return { state: row.state, resetsAt: row.resets_at }
      if (row.state !== 'started') return { state: row.state }
      const notes = notesContextFromTopic(row.topic.title, row.passages)
      if (notes === null || !outlasts(row.reservation_seconds, CHAT_TIMEOUT_MS)) return null
      return { state: 'started', replyId: row.reply_id, limits: { model: row.model, maxOutputTokens: row.max_output_tokens },
        course: row.course, topicTitle: row.topic.title, notes }
    },
    async finish(replyId, settlement: AskSettlement): Promise<boolean> {
      const { data, error } = await withAiDeadline(signal => service().rpc('finish_campus_bot_chat', {
        p_user_id: userId, p_reply_id: replyId, p_outcome: settlement.outcome,
        p_reply: settlement.outcome === 'answered'
          ? { text: settlement.reply.text, in_notes: settlement.reply.inNotes } : null,
        p_usage: usageJson(settlement.usage) }).abortSignal(signal), AI_SETTLEMENT_TIMEOUT_MS)
        .catch(() => ({ data: null, error: true }))
      const parsed = askFinish.safeParse(data)
      return !error && parsed.success && parsed.data.outcome === 'answered'
    },
  }
}

/** Verify the live session and page continuity, then run one command for that student only. */
export async function runCampusBotRequest(input: unknown, response: NextResponse, pageToken: string | null):
  Promise<ExplainResult | AskResult> {
  if (!isStudentAuthEnabled()) return { status: 'disabled' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = campusBotCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const command = parsed.data
    const provider = campusBotProvider()
    if (command.operation === 'explain') {
      return await explainQuestion(createSupabaseExplainEnv(client, context.user.id, context.sessionId, provider),
        command)
    }
    // The course behind the slug, on the student's own client. Access to it is the database's decision at admission.
    const course = await getStudentCourseBySlugForVerifiedStudent(client, command.courseSlug)
    if (course.status === 'signed-out' || course.status === 'not-found') return { status: course.status }
    if (course.status !== 'ok' && course.status !== 'repository-only') return { status: 'unavailable' }
    return await askCampusBot(createSupabaseAskEnv(client, context.user.id, context.sessionId, provider), {
      courseId: course.course.repository.repositoryCourseId, itemId: command.itemId, requestId: command.requestId,
      message: command.message, history: command.history })
  } catch (error) {
    console.error('campus-bot: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
