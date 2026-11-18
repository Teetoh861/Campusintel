// lib/campus-bot/ask.ts — One Ask Campus Bot reply about the topic a student is reading, over an injected, already
// authorized environment. The database decides the topic the student may ask about, the funding and the limits, and
// returns that topic's notes and nothing else (begin_campus_bot_chat): no question bank or answer key is ever in
// reach of a chat. The chat itself lives in the page; what arrives here is the new message and a few recent turns.
import 'server-only'
import { CHAT_LIMITS } from './contract'
import { callCampusBotModel, fitNotesPrompt } from './model-call'
import { buildAskPrompt } from './prompts'
import { capWords, plainText, REPLY_WORDS, studentText } from './reply-text'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { AskResult, CampusBotNoticeKind } from './contract'
import type { CampusBotModelLimits } from './model-call'
import type { NotesContext } from './notes-context'
import type { ChatTurn, CourseLabel } from './prompts'

/** Deadline of the one call; the reservation outlasts admission, this and settlement. */
export const CHAT_TIMEOUT_MS = 25_000

export type ChatReply = { text: string; inNotes: boolean }

export type AskBegin =
  | { state: 'started'; replyId: string; limits: CampusBotModelLimits; course: CourseLabel; topicTitle: string
      notes: NotesContext }
  // This message was already answered: the reply while it is kept, null once it has been deleted.
  | { state: 'answered'; reply: ChatReply | null }
  | { state: 'session-limit' | 'week-limit'; resetsAt: string | null }
  | { state: 'signed-out' | 'disabled' | 'not-found' | 'exam-open' | 'locked' | 'not-entitled' | 'busy'
      | 'undelivered-limit' | 'pass-limit' | 'capacity' }

export type AskSettlement =
  | { outcome: 'answered'; reply: ChatReply; usage: UsageReport }
  | { outcome: 'failed'; usage: UsageReport | null }

export type AskEnv = {
  provider: QuestionGenerationProvider | null
  begin(requestId: string, courseId: string, itemId: string, generate: boolean): Promise<AskBegin | null>
  /** Settle. True when the reply was recorded as delivered. */
  finish(replyId: string, settlement: AskSettlement): Promise<boolean>
  notice(): Promise<CampusBotNoticeKind>
  plansOnSale(): Promise<boolean>
  reportProviderProblem(code: ProviderErrorCode, diagnostic: ProviderDiagnostic): void
}

export type AskCommand = { courseId: string; itemId: string; requestId: string; message: string
  history: ReadonlyArray<ChatTurn> }

/** A chat reply as plain text within its length, with whether it came from the notes; null when it is not one. The
 *  same reading serves the student and the human review. */
export function readChatReply(json: unknown): ChatReply | null {
  if (typeof json !== 'object' || json === null) return null
  const { inNotes, reply } = json as Record<string, unknown>
  if (typeof inNotes !== 'boolean' || typeof reply !== 'string') return null
  const text = capWords(plainText(reply), REPLY_WORDS.chat.ceiling)
  return text === '' ? null : { text, inNotes }
}

/** The recent turns as data for the prompt: the last few only, each cleaned and within its length. */
export function recentTurns(history: ReadonlyArray<ChatTurn>): ChatTurn[] {
  return history.slice(-CHAT_LIMITS.turns).flatMap(turn => {
    const text = studentText(turn.text, CHAT_LIMITS.turnChars)
    return text === '' ? [] : [{ role: turn.role, text }]
  })
}

/** Answer one message for the verified student bound into env. Every outcome is a value. */
export async function askCampusBot(env: AskEnv, command: AskCommand): Promise<AskResult> {
  const message = studentText(command.message, CHAT_LIMITS.messageChars)
  if (message === '') return { status: 'invalid-request' }
  const begun = await env.begin(command.requestId, command.courseId, command.itemId, env.provider !== null)
  if (begun === null) return { status: 'unavailable' }
  if (begun.state === 'answered') {
    // A retry of a message already answered is free while the reply is kept. After that there is nothing to show,
    // and trying the same message again cannot help: the student asks again, as a new message.
    return begun.reply === null ? { status: 'not-found' } : { status: 'answered', ...begun.reply }
  }
  if (begun.state === 'session-limit' || begun.state === 'week-limit') {
    return { status: 'limit', limit: begun.state === 'session-limit' ? 'session' : 'week', resetsAt: begun.resetsAt }
  }
  if (begun.state === 'pass-limit') return { status: 'limit', limit: 'pass', resetsAt: null }
  if (begun.state === 'undelivered-limit') return { status: 'limit', limit: 'undelivered', resetsAt: null }
  if (begun.state === 'not-entitled') return { status: 'not-entitled', notice: await env.notice() }
  if (begun.state === 'locked') return { status: 'locked', plansOnSale: await env.plansOnSale() }
  if (begun.state === 'busy') return { status: 'in-progress' }
  if (begun.state === 'capacity') return { status: 'busy' }
  if (begun.state !== 'started') return { status: begun.state }
  const provider = env.provider
  if (provider === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: null })
    return { status: 'disabled' }
  }

  // The whole prompt stays within the input cap admitted: as much of the topic's notes as fits.
  const turns = recentTurns(command.history)
  const fitted = fitNotesPrompt(begun.notes, notes => buildAskPrompt(begun.course, begun.topicTitle, notes, turns, message),
    begun.limits)
  if (fitted === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: null })
    return { status: 'failed' }
  }
  const { prompt } = fitted
  const reply = await callCampusBotModel(provider, { ...prompt, limits: begun.limits, effort: 'low',
    timeoutMs: CHAT_TIMEOUT_MS })
  if (reply.kind === 'failed') {
    env.reportProviderProblem(reply.code, reply.diagnostic)
    await env.finish(begun.replyId, { outcome: 'failed', usage: null })
    return { status: 'busy' }
  }
  const answer = reply.kind === 'completed' ? readChatReply(reply.json) : null
  if (answer === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage })
    return { status: 'failed' }
  }
  // Shown only once it is recorded as delivered: that record is also what makes a retry free.
  const recorded = await env.finish(begun.replyId, { outcome: 'answered', reply: answer, usage: reply.usage })
  return recorded ? { status: 'answered', ...answer } : { status: 'failed' }
}
