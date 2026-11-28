import { z } from 'zod'

export const ORIENTATION_PATH = '/orientation'
export const ORIENTATION_HOST_PATH = '/admin/orientation'
export const PIN_PATTERN = /^[0-9]{6}$/
export const LOBBY_POLL_MS = 5_000
export const LIVE_POLL_MS = 2_000
export const HOST_POLL_MS = 1_000
export const QUESTION_COUNT = 15
export const ORIENTATION_BODY_MAX_BYTES = 200_000
export const START_COUNTDOWN_MS = 10_000
export const GET_READY_MS = 4_000
export const ANSWERING_MS = 15_000
export const prizeSchema = z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const phase = z.enum(['draft', 'lobby', 'live', 'ended', 'off'])
const leader = z.object({ name: z.string(), position: z.number().int(), score: z.number().int() }).strict()
export const questionSchema = z.object({ id: uuid, number: z.number().int(), prompt: z.string(),
  options: z.string().array().min(2).max(4), opensAt: timestamp, closesAt: timestamp,
  selected: z.number().int().nullable(), answered: z.number().int(), correct: z.number().int().nullable(), gotIt: z.boolean().nullable() }).strict()
const player = z.object({ name: z.string(), score: z.number().int(), position: z.number().int(),
  prize: z.string().nullable(), prizePosition: z.number().int().nullable(),
  claimCode: z.string().nullable(), collected: z.boolean().nullable() }).strict()
export const playerStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('inactive') }).strict(),
  z.object({ status: z.literal('join'), eventId: uuid, title: z.string(), phase, firstName: z.string().nullable() }).strict(),
  z.object({ status: z.literal('ok'), eventId: uuid, title: z.string(), kind: z.enum(['official','practice']), phase,
    serverNow: timestamp, startsAt: timestamp.nullable(), joined: z.number().int(), question: questionSchema.nullable(), me: player,
    top: leader.array(), drawPending: z.boolean() }).strict(),
])
export type PlayerState = z.infer<typeof playerStateSchema>
/** Keep uncollected winners current even after the host switches play off. */
export function playerPollInterval(data: PlayerState | null): number | null {
  if (data?.status === 'inactive') return null
  if (data?.status === 'ok') {
    if (data.phase === 'off' && (!data.me.claimCode || data.me.collected)) return null
    if (data.phase === 'live' || (data.phase === 'ended' && data.drawPending)) return LIVE_POLL_MS
  }
  return LOBBY_POLL_MS
}
export type Question = z.infer<typeof questionSchema>
const tieGroup = z.object({ position: z.number().int().positive(),candidates: uuid.array().min(2),
  places: z.number().int().positive(),prizes: z.string().nullable().array().min(2) }).strict()
export const hostStateSchema = z.object({ status: z.enum(['empty','ok']),
  events: z.object({ id: uuid, title: z.string(), kind: z.string(), phase }).strict().array(),
  eventId: uuid.optional(), title: z.string().optional(), kind: z.string().optional(), phase: phase.optional(),
  pin: z.string().nullable().optional(), prizes: prizeSchema.array().max(300).optional(),
  startsAt: timestamp.nullable().optional(), staff: z.object({ userId: uuid,email: z.string() }).strict().array().optional(), winnerCount: z.number().int().optional(), serverNow: timestamp.optional(),
  questionId: uuid.nullable().optional(), number: z.number().int().nullable().optional(),
  opensAt: timestamp.nullable().optional(), closesAt: timestamp.nullable().optional(), answered: z.number().int().optional(),
  questions: z.object({ id: uuid, ordinal: z.number().int(), category: z.string(), spare: z.boolean(), prompt: z.string(),
    options: z.string().array(), correct: z.number().int(), current: z.boolean(), used: z.boolean() }).strict().array().optional(),
  players: z.object({ id: uuid, name: z.string(), hidden: z.boolean(), score: z.number().int(), position: z.number().int(), timeUs: z.number().int() }).strict().array().optional(),
  ties: z.object({ needed: z.boolean(),groups: tieGroup.array() }).strict().nullable().optional(),
  draw: z.object({ startedBy: uuid, startedAt: timestamp,groups: tieGroup.extend({ order: uuid.array().min(2) }).array() }).strict().nullable().optional(),
  winners: z.object({ playerId: uuid, position: z.number().int(), prize: z.string(), name: z.string(), code: z.string(), collectedAt: timestamp.nullable() }).strict().array().optional(),
}).strict()
export type HostState = z.infer<typeof hostStateSchema>
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), pin: z.string().regex(PIN_PATTERN), firstName: z.string().trim().min(1).max(80), surname: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal('answer'), eventId: uuid, questionId: uuid, option: z.number().int().min(0).max(3) }).strict(),
  z.object({ action: z.enum(['lobby','start','next','skip','hide','end','draw','collect','off','prizes','staff-add','staff-remove']), eventId: uuid,
    questionId: uuid.nullable(), target: uuid.optional(), prizes: prizeSchema.array().max(300).optional(), email: z.string().trim().email().max(254).optional() }).strict(),
])
export const MESSAGES: Record<string, string> = {
  'wrong-pin': 'Check the game PIN.', limited: 'Too many tries. Try again in five minutes.', invalid: 'Check your details.',
  closed: 'Time’s up.', 'not-joined': 'Join the quiz to answer.', stale: 'The quiz has moved on.',
  'still-open': 'This question is still open.', 'no-spare': 'There are no unused spares.',
  'too-few-players': 'There are fewer players than prizes.', 'not-finished': 'Finish all fifteen questions first.',
  frozen: 'The prizes are frozen with the results.', 'prizes-required': 'Save at least one prize before starting.',
  'staff-missing': 'No confirmed account with this email.',
  finish: 'All fifteen questions are complete. End the quiz to choose the winners.',
}

export const staffEventsSchema = z.object({ events: z.object({ id: uuid,title: z.string() }).strict().array() }).strict()
export const staffClaimSchema = z.discriminatedUnion('status',[
  z.object({ status: z.literal('missing') }).strict(),
  z.object({ status: z.literal('ok'),winner: z.object({ name: z.string(),position: z.number().int(),prize: z.string(),collectedAt: timestamp.nullable() }).strict() }).strict(),
])
export type StaffClaim = z.infer<typeof staffClaimSchema>
export const staffRequestSchema = z.object({ eventId: uuid,code: z.string().min(1).max(80),collect: z.boolean() }).strict()
