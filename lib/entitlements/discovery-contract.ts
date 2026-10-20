// lib/entitlements/discovery-contract.ts — Discovery Pass previews as they may cross the client boundary.
// The database pins each preview and decides every limit, deadline and expiry (20261021100000_discovery_pass.sql); the
// CBT exam carries no answer key until the server has graded it. There is no theory preview.
import { z } from 'zod'
import { noteContent } from '@/lib/operator/editor-contract'

export const DISCOVERY_KINDS = ['cbt', 'study_guide'] as const
export const discoveryKind = z.enum(DISCOVERY_KINDS)
export type DiscoveryKind = z.infer<typeof discoveryKind>

/** URL segment of each preview page: /courses/[slug]/preview/[segment]. */
export const PREVIEW_SEGMENT: Record<DiscoveryKind, string> = { cbt: 'cbt', study_guide: 'study-guide' }

export function kindFromSegment(segment: string): DiscoveryKind | null {
  return DISCOVERY_KINDS.find(kind => PREVIEW_SEGMENT[kind] === segment) ?? null
}

// Mirrors the database bounds: at most 100 pinned questions of at most 8 options.
const MAX_SAMPLE_QUESTIONS = 100
const MAX_OPTION_INDEX = 7
const courseSlug = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const timestamp = z.string().min(1)
const uuid = z.string().uuid()

export const sampleAnswers = z.record(uuid, z.number().int().min(0).max(MAX_OPTION_INDEX))
  .refine(answers => Object.keys(answers).length <= MAX_SAMPLE_QUESTIONS)
export type SampleAnswers = z.infer<typeof sampleAnswers>

export const discoveryCommandSchema = z.discriminatedUnion('action', [
  // The study guide names the topic the student chose; the exam names nothing else. Duration never comes from here.
  z.object({ action: z.literal('open'), courseSlug, kind: z.literal('cbt') }).strict(),
  z.object({ action: z.literal('open-topic'), courseSlug, itemId: uuid }).strict(),
  z.object({ action: z.literal('submit-exam'), courseSlug, answers: sampleAnswers }).strict(),
])
export type DiscoveryCommand = z.infer<typeof discoveryCommandSchema>

// Titles only: a topic's body is never sent before the student opens it.
const topicTitle = z.object({ item_id: uuid, title: z.string() }).strict()
const sampleQuestion = z.object({ item_id: uuid, prompt: z.string(), options: z.array(z.string()).min(2).max(8),
  section: z.string() }).strict()
const sampleResult = z.object({
  score: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  // The exam closed at its deadline without an answer sheet arriving in time.
  timed_out: z.boolean(),
  answers: z.array(z.object({ item_id: uuid, selected: z.number().int().nonnegative().nullable(),
    correct_option: z.number().int().nonnegative(), explanation: z.string().nullable() }).strict()),
}).strict()

export const discoveryPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cbt'), deadline_at: timestamp,
    questions: z.array(sampleQuestion).min(1).max(MAX_SAMPLE_QUESTIONS), result: sampleResult.nullable() }).strict(),
  z.object({ kind: z.literal('study_guide'), items: z.array(z.object({ item_id: uuid, revision: z.number().int().positive(),
    note: noteContent }).strict()).length(1) }).strict(),
])
export type DiscoveryPreview = z.infer<typeof discoveryPreviewSchema>
export type SampleQuestion = z.infer<typeof sampleQuestion>
export type TopicTitle = z.infer<typeof topicTitle>
export type SampleResult = z.infer<typeof sampleResult>

const PLAIN_STATUSES = ['signed-out', 'session-changed', 'invalid-request', 'not-found', 'free-course', 'full-access',
  'no-pass', 'expired', 'nothing-to-preview', 'not-opened', 'unavailable'] as const

export const discoveryResultSchema = z.discriminatedUnion('status', [
  // `now` is the database clock at the time of the answer, for countdown display only.
  z.object({ status: z.literal('ready'), now: timestamp, endsAt: timestamp, preview: discoveryPreviewSchema }).strict(),
  z.object({ status: z.literal('available'), now: timestamp, endsAt: timestamp, topics: z.array(topicTitle).nullable() })
    .strict(),
  z.object({ status: z.literal('used-elsewhere'), endsAt: timestamp, courseCode: z.string().nullable(),
    courseSlug: z.string().nullable() }).strict(),
  ...PLAIN_STATUSES.map(status => z.object({ status: z.literal(status) }).strict()),
])
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>
export type DiscoveryResultStatus = DiscoveryResult['status']
