// lib/ai-practice/topic-contract.ts — "Quiz me on this topic" as it crosses the client boundary. The browser names a
// course by its slug, one of its notes topics and a request id of its own (a retry repeats it). The student, the topic
// they may read, the notes, the funding and every limit are the server's and the database's
// (20261117110000_campus_bot_topic_sets.sql). A result carries no prompt, key or provider detail. The problem statuses
// are Explain and Ask Campus Bot's own (lib/campus-bot/contract.ts), so the topic page shows them the same way.
import { z } from 'zod'
import { campusBotLimit, campusBotNoticeKind } from '@/lib/campus-bot/contract'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const courseSlug = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const TOPIC_SET_OPERATION = 'generate-topic'

export const topicSetCommandSchema = z.object({ operation: z.literal(TOPIC_SET_OPERATION), courseSlug, itemId: uuid,
  requestId: uuid }).strict()
export type TopicSetCommand = z.input<typeof topicSetCommandSchema>

/** Whether a request body is a topic set command, before it is checked in full. */
export function isTopicSetCommand(input: unknown): boolean {
  return typeof input === 'object' && input !== null && (input as { operation?: unknown }).operation === TOPIC_SET_OPERATION
}

const PLAIN_STATUSES = ['in-progress', 'busy', 'disabled', 'failed', 'not-found', 'signed-out', 'session-changed',
  'invalid-request', 'unavailable'] as const

export const topicSetResultSchema = z.discriminatedUnion('status', [
  // The set was written (or written already for this request id): it opens on its own page.
  z.object({ status: z.literal('ready'), setId: z.string().uuid() }).strict(),
  z.object({ status: z.literal('not-entitled'), notice: campusBotNoticeKind }).strict(),
  // A Campus Bot limit: this session's or this week's, with when it resets; the free pass's one set; or too many tries.
  z.object({ status: z.literal('limit'), limit: campusBotLimit, resetsAt: z.string().min(1).nullable() }).strict(),
  // The topic is no longer included for this student.
  z.object({ status: z.literal('locked'), plansOnSale: z.boolean() }).strict(),
  ...PLAIN_STATUSES.map(status => z.object({ status: z.literal(status) }).strict()),
])
export type TopicSetResult = z.infer<typeof topicSetResultSchema>
export type TopicSetProblem = Exclude<TopicSetResult, { status: 'ready' }>

/** Where a written set opens. */
export function topicSetPath(courseSlug: string, setId: string): string {
  return `/courses/${encodeURIComponent(courseSlug)}/campus-bot/${encodeURIComponent(setId)}`
}
