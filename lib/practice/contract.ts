// lib/practice/contract.ts — Server-run CBT practice as it may cross the client boundary
// (20261025100000_server_run_practice.sql). The database draws each attempt, fixes its deadline, keeps the sheet saved
// before it and grades it once. An open attempt carries prompts, options and sections only; correct options and
// explanations exist in this contract only on a graded attempt. Every shape is strict, so a key that leaks into an
// open attempt fails the whole answer closed.
import { z } from 'zod'
import { MAX_SAVE_REVISION, sampleAnswers } from '@/lib/entitlements/discovery-contract'
import type { SampleAnswers } from '@/lib/entitlements/discovery-contract'

// Mirrors the database bounds: at most 100 pinned questions of at most 8 options.
const MAX_QUESTIONS = 100
const MAX_OPTION_INDEX = 7
const courseSlug = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().min(1)
const sequence = z.number().int().min(0).max(MAX_SAVE_REVISION)
const revision = z.number().int().min(0).max(MAX_SAVE_REVISION)
const option = z.number().int().min(0).max(MAX_OPTION_INDEX)

// A practice choice cannot be cleared, so a change is always one of the question's options.
export const practiceChanges = z.record(uuid, option)
  .refine(changes => Object.keys(changes).length <= MAX_QUESTIONS)
export type PracticeChanges = z.infer<typeof practiceChanges>
export type PracticeSheet = SampleAnswers

const delta = { attemptId: uuid, tab: uuid, sequence, baseRevision: revision, changes: practiceChanges }

export const practiceCommandSchema = z.discriminatedUnion('action', [
  // The student names the course, a fresh attempt id (the retry key for a lost response), what to start and the brief
  // they confirmed. Size, duration and sections are the server's own; the database draws the questions.
  z.object({ action: z.literal('start'), courseSlug, attemptId: uuid, intent: z.enum(['new', 'redo']),
    redoOf: uuid.nullable(), expected: z.object({ questionCount: z.number().int().min(1).max(MAX_QUESTIONS),
      durationSeconds: z.number().int().min(1).max(10_800) }).strict() }).strict(),
  // One of the student's own attempts: open to resume, or graded for its result and review.
  z.object({ action: z.literal('attempt'), attemptId: uuid }).strict(),
  z.object({ action: z.literal('save'), ...delta, sequence: sequence.min(1),
    changes: practiceChanges.refine(changes => Object.keys(changes).length > 0) }).strict(),
  // The database clock, the deadline and the sheet that stands. Changes nothing.
  z.object({ action: z.literal('sync'), attemptId: uuid, tab: uuid }).strict(),
  z.object({ action: z.literal('submit'), ...delta }).strict(),
// A redo names the graded attempt it repeats; a new attempt names none.
]).refine(command => command.action !== 'start' || (command.intent === 'redo') === (command.redoOf !== null))
export type PracticeCommand = z.input<typeof practiceCommandSchema>
export type ParsedPracticeCommand = z.output<typeof practiceCommandSchema>

const question = z.object({ questionId: z.string().uuid(), prompt: z.string(),
  options: z.array(z.string()).min(2).max(8), section: z.string() }).strict()
const gradedQuestion = question.extend({ itemId: z.string().uuid(), revision: z.number().int().positive(),
  selected: option.nullable(), correctOption: option, explanation: z.string().nullable() }).strict()
export type PracticeQuestion = z.infer<typeof question>
export type GradedQuestion = z.infer<typeof gradedQuestion>

const meta = {
  id: z.string().uuid(), courseId: z.string().uuid(), intent: z.enum(['new', 'redo']), redoOf: z.string().uuid().nullable(),
  startedAt: timestamp, deadlineAt: timestamp, durationSeconds: z.number().int().positive(),
  questionCount: z.number().int().positive(), bankSize: z.number().int().positive(),
}
export const practiceAttemptSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('in_progress'), ...meta, questions: z.array(question).min(1).max(MAX_QUESTIONS),
    saved: z.object({ revision, answers: sampleAnswers }).strict() }).strict(),
  z.object({ status: z.enum(['submitted', 'timed_out']), ...meta, questions: z.array(gradedQuestion).min(1).max(MAX_QUESTIONS),
    result: z.object({ score: z.number().int().nonnegative(), total: z.number().int().positive(), timedOut: z.boolean(),
      finishedAt: timestamp }).strict() }).strict(),
])
export type PracticeAttempt = z.infer<typeof practiceAttemptSchema>
export type OpenAttempt = Extract<PracticeAttempt, { status: 'in_progress' }>
export type GradedAttempt = Exclude<PracticeAttempt, OpenAttempt>

const PLAIN_STATUSES = ['signed-out', 'session-changed', 'invalid-request', 'not-found', 'conflict', 'locked',
  'questions-changed', 'unavailable'] as const

export const practiceResultSchema = z.discriminatedUnion('status', [
  // `now` is the database clock at the answer; with `deadlineAt` it sets the countdown, never the device clock.
  z.object({ status: z.enum(['ready', 'graded', 'in-progress']), now: timestamp, attempt: practiceAttemptSchema }).strict(),
  z.object({ status: z.enum(['saved', 'stale', 'too-many-tabs']), now: timestamp, deadlineAt: timestamp, revision,
    answers: sampleAnswers }).strict(),
  // The brief no longer matches what would start; nothing started. The student is asked again with these values.
  z.object({ status: z.literal('policy-changed'), questionCount: z.number().int().positive(),
    durationSeconds: z.number().int().positive(), bankSize: z.number().int().nonnegative() }).strict(),
  ...PLAIN_STATUSES.map(status => z.object({ status: z.literal(status) }).strict()),
])
export type PracticeResult = z.infer<typeof practiceResultSchema>
export type PracticeResultStatus = PracticeResult['status']

/** D4: a bank no larger than the attempt (at the attempt's start) offers one "Practise again", never Retake and Redo. */
export function wholeBankAttempt(attempt: Pick<PracticeAttempt, 'bankSize' | 'questionCount'>): boolean {
  return attempt.bankSize <= attempt.questionCount
}
