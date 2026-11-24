// lib/campus-bot/contract.ts — Campus Bot Explain and Ask Campus Bot as they cross the client boundary. The browser
// names an attempt and a question, or a topic and what the student typed. The student, the course access, the answer
// key, the notes and every limit are the server's and the database's. No result carries a prompt, a key or a provider
// detail, and every shape is strict.
import { z } from 'zod'

/** A chat message, and the earlier turns sent with it: the page keeps the chat, so only the last few travel. A bot
 *  turn carries the check question it asked, if any; a reply's memory trick has its own, shorter limit. */
export const CHAT_LIMITS = { messageChars: 500, turnChars: 600, turns: 6, checkChars: 300, memoryTrickChars: 200 } as const

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const courseSlug = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const turnText = z.string().min(1).max(CHAT_LIMITS.turnChars)
const checkText = z.string().min(1).max(CHAT_LIMITS.checkChars)
const chatTurn = z.discriminatedUnion('role', [
  z.object({ role: z.literal('student'), text: turnText }).strict(),
  // The check question a Campus Bot turn asked travels with it, so the next reply knows an answer is due.
  z.object({ role: z.literal('bot'), text: turnText, check: checkText.optional() }).strict(),
])

export const campusBotCommandSchema = z.discriminatedUnion('operation', [
  // Explain: only the attempt and the question. The choice, the key and the notes are read on the server.
  z.object({ operation: z.literal('explain'), attemptId: uuid, questionId: uuid }).strict(),
  // Ask: the topic being read, a fresh id for this message (a retry repeats it), the message and the recent turns.
  z.object({ operation: z.literal('ask'), courseSlug, itemId: uuid, requestId: uuid,
    message: z.string().max(CHAT_LIMITS.messageChars).refine(value => value.trim().length > 0),
    history: z.array(chatTurn).max(CHAT_LIMITS.turns) }).strict(),
])
export type CampusBotCommand = z.input<typeof campusBotCommandSchema>
export type ParsedCampusBotCommand = z.output<typeof campusBotCommandSchema>

/** Which line the student without Campus Bot reads: plans on sale, a free pass they can still start, or neither. */
export const campusBotNoticeKind = z.enum(['subscribe', 'free-pass', 'plan'])
export type CampusBotNoticeKind = z.infer<typeof campusBotNoticeKind>
export const campusBotLimit = z.enum(['session', 'week', 'pass', 'undelivered'])
export type CampusBotLimit = z.infer<typeof campusBotLimit>

/** A notes topic as a link: its place on the course's notes page and its title. */
const topicLink = z.object({ number: z.number().int().positive(), title: z.string().min(1) }).strict()
export type TopicLink = z.infer<typeof topicLink>

const replyText = z.string().min(1).max(4_000)
const PLAIN_STATUSES = ['busy', 'in-progress', 'exam-open', 'disabled', 'failed', 'not-found', 'signed-out',
  'session-changed', 'invalid-request', 'unavailable'] as const

const shared = [
  z.object({ status: z.literal('not-entitled'), notice: campusBotNoticeKind }).strict(),
  // A Campus Bot limit: this session's or this week's, with when it resets; the free pass's count; or too many tries today.
  z.object({ status: z.literal('limit'), limit: campusBotLimit, resetsAt: z.string().min(1).nullable() }).strict(),
  // The course is no longer included for this student: the same line as a withheld answer review.
  z.object({ status: z.literal('locked'), plansOnSale: z.boolean() }).strict(),
  ...PLAIN_STATUSES.map(status => z.object({ status: z.literal(status) }).strict()),
] as const

export const explainResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('explained'), text: replyText, topic: topicLink.nullable() }).strict(),
  z.object({ status: z.literal('not-covered') }).strict(),
  // A calculation course's explanation did not pass its check: the notes topic to read instead.
  z.object({ status: z.literal('check-failed'), topic: topicLink.nullable() }).strict(),
  ...shared,
])
export type ExplainResult = z.infer<typeof explainResultSchema>

/** How Campus Bot marked the student's answer to its last check question; 'none' when the message was not one. */
export const chatVerdict = z.enum(['correct', 'not-quite', 'none'])
export type ChatVerdict = z.infer<typeof chatVerdict>

export const askResultSchema = z.discriminatedUnion('status', [
  // The reply, how it marked an answer, the check question it asks next and a memory trick. Never the check's answer.
  z.object({ status: z.literal('answered'), text: replyText, inNotes: z.boolean(), verdict: chatVerdict,
    check: checkText.nullable(), memoryTrick: z.string().min(1).max(CHAT_LIMITS.memoryTrickChars).nullable() }).strict(),
  ...shared,
])
export type AskResult = z.infer<typeof askResultSchema>

export type CampusBotResult = ExplainResult | AskResult
export type CampusBotProblem = Exclude<CampusBotResult, { status: 'explained' | 'not-covered' | 'check-failed' | 'answered' }>
