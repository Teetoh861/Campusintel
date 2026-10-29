// lib/practice/server.ts — Server entry points for server-run CBT practice. The practice functions are service-role
// only and take the verified session id, so the database derives the student, draws and pins each attempt, holds its
// deadline on its own clock and grades it once (20261025100000_server_run_practice.sql). The course comes from the
// central read model on the student's own client; attempt size, duration and section order come from the server's quiz
// configuration. The browser supplies only the attempt id it retries with, the brief it confirmed, and its choices.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { sampleAnswers } from '@/lib/entitlements/discovery-contract'
import { createClient } from '@/lib/supabase/server'
import { practiceAttemptSchema, practiceCommandSchema } from './contract'
import type { NextResponse } from 'next/server'
import type { PracticeAttempt, PracticeChanges, PracticeResult } from './contract'

type StudentClient = Awaited<ReturnType<typeof createClient>>

/** The server's own practice policy for a course: never accepted from the browser (D5). */
export type PracticePolicy = { size: number; seconds: number; sections: string[] }

export function practicePolicyFor(slug: string): PracticePolicy | null {
  const config = getQuizConfigurationByCourseSlug(slug)
  if (!config || config.courseSlug !== slug) return null
  const seconds = Math.round(config.quizDurationMinutes * 60)
  if (!Number.isSafeInteger(config.maxQuizQuestions) || config.maxQuizQuestions <= 0 || !Number.isSafeInteger(seconds) ||
      seconds <= 0) return null
  return { size: config.maxQuizQuestions, seconds, sections: [...config.sections] }
}

/** Instant feedback: up to 10 questions, closed by the server 3 hours after it started if left (never shown). */
export const INSTANT_POLICY = { size: 10, seconds: 3 * 60 * 60 } as const

export type PracticeDelta = { tab: string; sequence: number; baseRevision: number; changes: PracticeChanges }
export type PracticeStart = { attemptId: string; courseId: string; intent: 'new' | 'redo'; redoOf: string | null
  policy: PracticePolicy; expected: { questionCount: number; durationSeconds: number; wholeBank: boolean } }
  // Instant feedback: a fresh draw with the server's instant size and closing time, and no brief.
  | { attemptId: string; courseId: string; mode: 'instant'; sections: string[] }

export type PracticeEnv = {
  start(start: PracticeStart): Promise<unknown>
  state(courseId: string): Promise<unknown>
  attempt(attemptId: string): Promise<unknown>
  save(attemptId: string, delta: PracticeDelta): Promise<unknown>
  submit(attemptId: string, delta: PracticeDelta): Promise<unknown>
  pick(attemptId: string, questionId: string, option: number): Promise<unknown>
}

// ---------------------------------------------------------------------------
// The database's answers, mapped to the client contract. Anything missing or malformed is `unavailable`.
// ---------------------------------------------------------------------------
const timestamp = z.string().min(1)
const dbQuestion = z.object({ question_id: z.string().uuid(), prompt: z.string(), options: z.array(z.string()),
  section: z.string() }).strict()
const dbGradedQuestion = dbQuestion.extend({ item_id: z.string().uuid(), revision: z.number().int(),
  selected: z.number().int().nullable(), correct_option: z.number().int(), explanation: z.string().nullable() }).strict()
// An instant attempt's picked question carries its pick, correct option and explanation, all three or none.
const dbOpenQuestion = dbQuestion.extend({ selected: z.number().int().optional(), correct_option: z.number().int().optional(),
  explanation: z.string().nullable().optional() }).strict()
const dbMeta = { id: z.string().uuid(), course_id: z.string().uuid(), mode: z.enum(['exam', 'instant']),
  intent: z.enum(['new', 'redo']),
  redo_of: z.string().uuid().nullable(), started_at: timestamp, deadline_at: timestamp,
  duration_seconds: z.number().int(), question_count: z.number().int(), bank_size: z.number().int() }
const dbAttempt = z.discriminatedUnion('status', [
  z.object({ status: z.literal('in_progress'), ...dbMeta, questions: z.array(dbOpenQuestion),
    saved: z.object({ revision: z.number().int(), answers: sampleAnswers }).strict(), result: z.null() }).strict(),
  z.object({ status: z.enum(['submitted', 'timed_out']), ...dbMeta, questions: z.array(dbGradedQuestion), saved: z.null(),
    result: z.object({ score: z.number().int(), total: z.number().int(), timed_out: z.boolean(), finished_at: timestamp })
      .strict() }).strict(),
])
const dbAnswer = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['ready', 'graded', 'in-progress']), now: timestamp, attempt: dbAttempt }).strict(),
  z.object({ state: z.enum(['picked', 'answer-locked']), now: timestamp, attempt: dbAttempt,
    pick: z.object({ question_id: z.string().uuid(), selected: z.number().int(), correct_option: z.number().int(),
      is_correct: z.boolean(), explanation: z.string().nullable() }).strict() }).strict(),
  z.object({ state: z.enum(['saved', 'stale', 'too-many-tabs']), now: timestamp, deadline_at: timestamp,
    revision: z.number().int(), answers: sampleAnswers }).strict(),
  z.object({ state: z.literal('policy-changed'), question_count: z.number().int(), duration_seconds: z.number().int(),
    bank_size: z.number().int() }).strict(),
  z.object({ state: z.enum(['signed-out', 'conflict', 'locked', 'not-found', 'questions-changed', 'unavailable',
    'invalid-course', 'invalid-request']) }).strict(),
])
// The practice functions raise this for a malformed request, such as an answer to a question outside the attempt.
const INVALID_REQUEST_CODE = '22023'

function rpcAnswer(data: unknown, error: { code?: string } | null): unknown {
  if (error === null) return data
  return error.code === INVALID_REQUEST_CODE ? { state: 'invalid-request' } : null
}

type DbOpenQuestion = z.infer<typeof dbOpenQuestion>

/** A blank explanation is no explanation: "Why" appears only when there is something to say. */
function explanationOf(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value
}

function openQuestionFrom(question: DbOpenQuestion) {
  const base = { questionId: question.question_id, prompt: question.prompt, options: question.options,
    section: question.section }
  const { selected, correct_option: correctOption, explanation } = question
  if (selected === undefined && correctOption === undefined && explanation === undefined) return base
  // Partial feedback is malformed: left as is, the strict contract refuses it.
  return { ...base, feedback: { selected, correctOption,
    explanation: explanation === undefined ? undefined : explanationOf(explanation) } }
}

function attemptFrom(row: z.infer<typeof dbAttempt>): PracticeAttempt | null {
  const meta = { id: row.id, courseId: row.course_id, mode: row.mode, intent: row.intent, redoOf: row.redo_of, startedAt: row.started_at,
    deadlineAt: row.deadline_at, durationSeconds: row.duration_seconds, questionCount: row.question_count,
    bankSize: row.bank_size }
  const mapped = row.status === 'in_progress'
    ? { status: row.status, ...meta, saved: row.saved, questions: row.questions.map(openQuestionFrom) }
    : { status: row.status, ...meta, result: { score: row.result.score, total: row.result.total,
      timedOut: row.result.timed_out, finishedAt: row.result.finished_at },
      questions: row.questions.map(question => ({ questionId: question.question_id, prompt: question.prompt,
        options: question.options, section: question.section, itemId: question.item_id, revision: question.revision,
        selected: question.selected, correctOption: question.correct_option, explanation: question.explanation })) }
  const parsed = practiceAttemptSchema.safeParse(mapped)
  return parsed.success ? parsed.data : null
}

/** Map one database answer to the client contract. */
export function practiceResultFrom(data: unknown): PracticeResult {
  const parsed = dbAnswer.safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }
  const row = parsed.data
  if (row.state === 'ready' || row.state === 'graded' || row.state === 'in-progress') {
    const attempt = attemptFrom(row.attempt)
    return attempt === null ? { status: 'unavailable' } : { status: row.state, now: row.now, attempt }
  }
  if (row.state === 'picked' || row.state === 'answer-locked') {
    const attempt = attemptFrom(row.attempt)
    if (attempt === null || attempt.mode !== 'instant') return { status: 'unavailable' }
    const { pick } = row
    return { status: row.state, now: row.now, attempt, pick: { questionId: pick.question_id, selected: pick.selected,
      correctOption: pick.correct_option, isCorrect: pick.is_correct, explanation: explanationOf(pick.explanation) } }
  }
  if (row.state === 'saved' || row.state === 'stale' || row.state === 'too-many-tabs') {
    return { status: row.state, now: row.now, deadlineAt: row.deadline_at, revision: row.revision, answers: row.answers }
  }
  if (row.state === 'policy-changed') {
    return { status: 'policy-changed', questionCount: row.question_count, durationSeconds: row.duration_seconds,
      bankSize: row.bank_size }
  }
  return { status: row.state === 'invalid-course' ? 'not-found' : row.state }
}

/** The practice page's state for a course: the open attempt to resume, or the most recent graded one, or none. */
export type PracticeState =
  | { status: 'open' | 'graded'; now: string; attempt: { id: string; mode: 'exam' | 'instant'; deadlineAt: string
      questionCount: number; answered: number; score: number | null; bankSize: number } }
  | { status: 'none' }
  | { status: 'signed-out' | 'unavailable' }

const dbState = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['open', 'graded']), now: timestamp, attempt: z.object({ id: z.string().uuid(),
    mode: z.enum(['exam', 'instant']), status: z.string(), intent: z.string(), started_at: timestamp, deadline_at: timestamp, duration_seconds: z.number().int(),
    question_count: z.number().int().positive(), bank_size: z.number().int().positive(), answered: z.number().int(),
    score: z.number().int().nullable(), finished_at: timestamp.nullable() }).strict() }).strict(),
  z.object({ state: z.literal('none'), now: timestamp }).strict(),
  z.object({ state: z.literal('signed-out') }).strict(),
])

export function practiceStateFrom(data: unknown): PracticeState {
  const parsed = dbState.safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }
  const row = parsed.data
  if (row.state === 'none') return { status: 'none' }
  if (row.state === 'signed-out') return { status: 'signed-out' }
  return { status: row.state, now: row.now, attempt: { id: row.attempt.id, mode: row.attempt.mode,
    deadlineAt: row.attempt.deadline_at,
    questionCount: row.attempt.question_count, answered: row.attempt.answered, score: row.attempt.score,
    bankSize: row.attempt.bank_size } }
}

function createSupabasePracticeEnv(sessionId: string): PracticeEnv {
  // Server-only client for the practice RPCs; mirrors lib/entitlements/discovery.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    async start(start) {
      if ('mode' in start) {
        const { data, error } = await service.rpc('practice_start', { p_session_id: sessionId,
          p_attempt_id: start.attemptId, p_course_id: start.courseId, p_intent: 'new', p_redo_of: null,
          p_size: INSTANT_POLICY.size, p_seconds: INSTANT_POLICY.seconds, p_sections: start.sections,
          p_expected_size: null, p_expected_seconds: null, p_expected_whole_bank: null, p_mode: 'instant' })
        return rpcAnswer(data, error)
      }
      const { data, error } = await service.rpc('practice_start', { p_session_id: sessionId, p_attempt_id: start.attemptId,
        p_course_id: start.courseId, p_intent: start.intent, p_redo_of: start.redoOf, p_size: start.policy.size,
        p_seconds: start.policy.seconds, p_sections: start.policy.sections,
        p_expected_size: start.expected.questionCount, p_expected_seconds: start.expected.durationSeconds,
        p_expected_whole_bank: start.expected.wholeBank })
      return rpcAnswer(data, error)
    },
    async state(courseId) {
      const { data, error } = await service.rpc('practice_state', { p_session_id: sessionId, p_course_id: courseId })
      return rpcAnswer(data, error)
    },
    async attempt(attemptId) {
      const { data, error } = await service.rpc('practice_attempt', { p_session_id: sessionId, p_attempt_id: attemptId })
      return rpcAnswer(data, error)
    },
    async save(attemptId, delta) {
      const { data, error } = await service.rpc('practice_save', { p_session_id: sessionId, p_attempt_id: attemptId,
        p_tab: delta.tab, p_sequence: delta.sequence, p_base_revision: delta.baseRevision, p_changes: delta.changes })
      return rpcAnswer(data, error)
    },
    async submit(attemptId, delta) {
      const { data, error } = await service.rpc('practice_submit', { p_session_id: sessionId, p_attempt_id: attemptId,
        p_tab: delta.tab, p_sequence: delta.sequence, p_base_revision: delta.baseRevision, p_changes: delta.changes })
      return rpcAnswer(data, error)
    },
    async pick(attemptId, questionId, option) {
      const { data, error } = await service.rpc('practice_pick', { p_session_id: sessionId, p_attempt_id: attemptId,
        p_question_id: questionId, p_option: option })
      return rpcAnswer(data, error)
    },
  }
}

/** The page's read of a course's practice state, for the verified session. Never starts anything. */
export async function readPracticeState(sessionId: string, courseId: string,
  env: PracticeEnv = createSupabasePracticeEnv(sessionId)): Promise<PracticeState> {
  try { return practiceStateFrom(await env.state(courseId)) } catch { return { status: 'unavailable' } }
}

/** The page's read of one of the student's own attempts (a reloadable result URL). Never starts anything. */
export async function readPracticeAttempt(sessionId: string, attemptId: string,
  env: PracticeEnv = createSupabasePracticeEnv(sessionId)): Promise<PracticeResult> {
  if (!z.string().uuid().safeParse(attemptId).success) return { status: 'not-found' }
  try { return practiceResultFrom(await env.attempt(attemptId.toLowerCase())) } catch { return { status: 'unavailable' } }
}

type CourseTarget = { status: 'ok'; courseId: string; policy: PracticePolicy }
  | { status: 'signed-out' | 'not-found' | 'unavailable' }

/** The repository course behind a slug, on the student's own client, with the server's policy for it. Access is not
 * decided here: the database judges it at the moment a fresh start runs. */
async function courseFor(client: StudentClient, slug: string): Promise<CourseTarget> {
  const result = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (result.status !== 'ok' && result.status !== 'repository-only') {
    return { status: result.status === 'invariant-failure' ? 'unavailable' : result.status }
  }
  const { repository } = result.course
  const policy = practicePolicyFor(repository.route.slug)
  return policy === null ? { status: 'not-found' } : { status: 'ok', courseId: repository.repositoryCourseId, policy }
}

/** Verify the live session and page continuity, then act on one of this student's practice attempts. */
export async function runPracticeRequest(input: unknown, response: NextResponse, pageToken: string | null,
  envFor: (sessionId: string) => PracticeEnv = createSupabasePracticeEnv): Promise<PracticeResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (pageToken === null || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = practiceCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const command = parsed.data
    const env = envFor(context.sessionId)
    if (command.action === 'attempt') return practiceResultFrom(await env.attempt(command.attemptId))
    if (command.action === 'pick') {
      return practiceResultFrom(await env.pick(command.attemptId, command.questionId, command.option))
    }
    if (command.action === 'sync') {
      // A delta with nothing in it: the database answers with its clock, the deadline and the sheet that stands.
      return practiceResultFrom(await env.save(command.attemptId,
        { tab: command.tab, sequence: 0, baseRevision: 0, changes: {} }))
    }
    if (command.action === 'save' || command.action === 'submit') {
      const { action, attemptId, ...delta } = command
      return practiceResultFrom(await (action === 'save' ? env.save : env.submit)(attemptId, delta))
    }
    const course = await courseFor(client, command.courseSlug)
    if (course.status !== 'ok') return { status: course.status }
    if (command.action === 'start-instant') {
      return practiceResultFrom(await env.start({ attemptId: command.attemptId, courseId: course.courseId, mode: 'instant',
        sections: course.policy.sections }))
    }
    return practiceResultFrom(await env.start({ attemptId: command.attemptId, courseId: course.courseId,
      intent: command.intent, redoOf: command.redoOf, policy: course.policy, expected: command.expected }))
  } catch (error) {
    console.error('practice: request failed', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable' }
  }
}
