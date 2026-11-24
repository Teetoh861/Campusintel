// lib/campus-bot/ask.ts — One Ask Campus Bot reply about the topic a student is reading, over an injected, already
// authorized environment. The database decides the topic the student may ask about, the funding and the limits, and
// returns that topic's notes and nothing else (begin_campus_bot_chat): no question bank or answer key is ever in
// reach of a chat. The chat itself lives in the page; what arrives here is the new message and a few recent turns.
import 'server-only'
import { CHAT_LIMITS } from './contract'
import { callCampusBotModel, fitNotesPrompt } from './model-call'
import { buildAskPrompt } from './prompts'
import { answerLeak, BOLD_MAX, BOLD_MAX_MEMORY_TRICK, boldTerms, capWords, comparable, echoLeak, hasEmoji, isLeadIn,
  markTerms, plainText, REPLY_WORDS, stripCheckInstruction, stripCheckLabel, stripLeadingVerdict, studentText,
  trickLettersMatch } from './reply-text'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { AskResult, CampusBotNoticeKind, ChatVerdict } from './contract'
import type { CampusBotModelLimits } from './model-call'
import type { NotesContext } from './notes-context'
import type { ChatTurn, CourseLabel } from './prompts'

/** Deadline of the one call; the reservation outlasts admission, this and settlement. */
export const CHAT_TIMEOUT_MS = 25_000

/** A reply as the student sees it and the database keeps it. The check question's answer is never part of it. */
export type ChatReply = { text: string; inNotes: boolean; verdict: ChatVerdict; check: string | null
  memoryTrick: string | null }

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

/** Which server guard changed what the model wrote: kept for the human review, never shown or stored. */
export type ChatGuard = 'emoji-removed' | 'verdict-without-check' | 'in-notes-set' | 'verdict-word-removed'
  | 'check-label-removed' | 'check-instruction-removed' | 'check-without-answer' | 'check-answer-leaked'
  | 'memory-trick-gave-answer' | 'check-echoes-reply' | 'memory-trick-echoes-check' | 'memory-trick-unmatched-bold-removed'
  | 'lead-in-without-check'
  | 'check-too-long'
  | 'memory-trick-too-long' | 'reply-bold-removed' | 'check-bold-removed' | 'memory-trick-bold-removed'

/** What a guard took out, for the human review only: never shown, stored or logged by the app. */
export type ChatRemoved = { check: string | null; memoryTrick: string | null }

const VERDICTS: ReadonlyArray<ChatVerdict> = ['correct', 'not-quite', 'none']

/** A field as plain text with its bold markers taken out, the terms they marked (null: unusable, shown unmarked), and
 *  whether it held an emoji (removed). `maxBold` is the field's limit of bold spans. */
function field(value: string, oneLine: boolean, maxBold: number):
  { plain: string; terms: string[] | null; emoji: boolean } {
  const kept = plainText(value, { keepBold: true })
  const { plain, terms } = boldTerms(oneLine ? kept.replace(/\s+/g, ' ').trim() : kept, maxBold)
  return { plain: plain.trim(), terms, emoji: hasEmoji(value) }
}

/** A field marked again: its terms, when they were usable and the result still fits; otherwise none. */
function remark(text: string, terms: string[] | null, maxChars: number): { text: string; removed: boolean } {
  if (terms === null) return { text, removed: true }
  const marked = markTerms(text, terms)
  return marked.length <= maxChars ? { text: marked, removed: false } : { text, removed: true }
}

/**
 * A chat reply as the student may see it, or null when the model's answer is not one; `reply` is null when the guards
 * leave nothing to show (a lead-in such as "Here's one." with no check question after it). `pending` is whether the
 * last Campus Bot turn asked a check question: only then can the student's message be marked. Emoji are removed from
 * every field first. The guards then run on each field as if its bold markers were not there, in order:
 * - a verdict without a check question waiting becomes 'none'; a marked reply is always from the notes;
 * - a marked reply never opens with a verdict word or praise phrase (the page shows the verdict itself);
 * - a memory trick whose bold first letters do not match (each bolded at least twice) is kept without its bold;
 * - a check question loses any label it opened with (the page adds its own) and any final instruction ("Answer with a
 *   single word."): the question itself asks;
 * - a check question without an answer is dropped;
 * - the answer's words the question does not already hold (answerLeak): all of them in the reply drops the check
 *   question; all of them only in the memory trick drops the memory trick;
 * - a question that offers its own answer (echoLeak): one sentence of the reply with the answer and another key word
 *   of the question drops the check question ("/s/ is voiceless" then "Is /s/ voiced or voiceless?"); one sentence of
 *   the memory trick alone drops the memory trick;
 * - the check question and the memory trick are plain text within their limits, or dropped.
 * Last, each field gets its bold terms back (at most BOLD_MAX, or BOLD_MAX_MEMORY_TRICK in a memory trick, in order); a
 * field whose markers do not pair up, are too many, or no longer fit, is shown without any. The check question's answer
 * is read here and nowhere else: it is never returned, stored or logged. The same reading serves the student and the
 * human review, which also reads which guards fired, what they removed and the bold terms.
 */
export function readChatReply(json: unknown, pending: boolean):
  { reply: ChatReply | null; guards: ChatGuard[]; removed: ChatRemoved } | null {
  if (typeof json !== 'object' || json === null) return null
  const { verdict: rawVerdict, inNotes: rawInNotes, reply, memoryTrick: rawTrick, check: rawCheck, checkAnswer } =
    json as Record<string, unknown>
  if (typeof rawInNotes !== 'boolean' || typeof reply !== 'string' || typeof rawVerdict !== 'string'
      || !VERDICTS.includes(rawVerdict as ChatVerdict) || typeof rawTrick !== 'string' || typeof rawCheck !== 'string'
      || typeof checkAnswer !== 'string') return null
  const guards: ChatGuard[] = []
  const removed: ChatRemoved = { check: null, memoryTrick: null }
  const replyField = field(reply, false, BOLD_MAX)
  const checkField = field(rawCheck, true, BOLD_MAX)
  const trickField = field(rawTrick, true, BOLD_MAX_MEMORY_TRICK)
  if (replyField.emoji || checkField.emoji || trickField.emoji || hasEmoji(checkAnswer)) guards.push('emoji-removed')
  let verdict = rawVerdict as ChatVerdict
  if (verdict !== 'none' && !pending) {
    verdict = 'none'
    guards.push('verdict-without-check')
  }
  let inNotes = rawInNotes
  if (verdict !== 'none' && !inNotes) {
    inNotes = true
    guards.push('in-notes-set')
  }
  let text = capWords(replyField.plain, REPLY_WORDS.chat.ceiling)
  if (verdict !== 'none') {
    const unmarked = stripLeadingVerdict(text)
    if (unmarked.stripped) guards.push('verdict-word-removed')
    text = unmarked.text
  }
  if (text === '') return null
  let memoryTrick: string | null = trickField.plain.length <= CHAT_LIMITS.memoryTrickChars ? trickField.plain : null
  if (memoryTrick === null) {
    guards.push('memory-trick-too-long')
    removed.memoryTrick = trickField.plain
  }
  // Bold first letters that do not pair up: the trick is kept, as plain text.
  let trickTerms = trickField.terms
  if (memoryTrick !== null && memoryTrick !== '' && trickTerms !== null && !trickLettersMatch(trickTerms)) {
    guards.push('memory-trick-unmatched-bold-removed')
    trickTerms = []
  }
  let check: string | null = null
  const unlabelled = stripCheckLabel(checkField.plain)
  const instructed = stripCheckInstruction(unlabelled.text)
  const labelled = { text: instructed.text }
  if (labelled.text !== '') {
    if (unlabelled.stripped) guards.push('check-label-removed')
    if (instructed.stripped) guards.push('check-instruction-removed')
    const answer = plainText(checkAnswer)
    if (labelled.text.length > CHAT_LIMITS.checkChars) guards.push('check-too-long')
    else if (comparable(answer) === '') guards.push('check-without-answer')
    else {
      const leak = answerLeak(answer, labelled.text, text, memoryTrick ?? '')
      const echo = leak === 'none' ? echoLeak(answer, labelled.text, text, memoryTrick ?? '') : 'none'
      if (leak === 'reply') guards.push('check-answer-leaked')
      else if (echo === 'reply') guards.push('check-echoes-reply')
      else {
        check = labelled.text
        if ((leak === 'memory-trick' || echo === 'memory-trick') && memoryTrick) {
          guards.push(leak === 'memory-trick' ? 'memory-trick-gave-answer' : 'memory-trick-echoes-check')
          removed.memoryTrick = memoryTrick
          memoryTrick = null
        }
      }
    }
    if (check === null) removed.check = labelled.text
  }
  // The bold terms back, each field on its own.
  const shown = remark(text, replyField.terms, 4_000)
  if (shown.removed) guards.push('reply-bold-removed')
  let finalCheck = check
  if (check !== null) {
    const marked = remark(check, checkField.terms, CHAT_LIMITS.checkChars)
    if (marked.removed) guards.push('check-bold-removed')
    finalCheck = marked.text
  }
  let finalTrick = memoryTrick || null
  if (finalTrick !== null) {
    const marked = remark(finalTrick, trickTerms, CHAT_LIMITS.memoryTrickChars)
    if (marked.removed) guards.push('memory-trick-bold-removed')
    finalTrick = marked.text
  }
  // A reply that only promises a question it then does not ask leaves the student nothing to answer: it is no reply.
  if (finalCheck === null && isLeadIn(text)) return { reply: null, guards: [...guards, 'lead-in-without-check'], removed }
  return { reply: { text: shown.text, inNotes, verdict, check: finalCheck, memoryTrick: finalTrick }, guards, removed }
}

/** Whether the last Campus Bot turn of the history asked a check question, so the new message may answer it. */
export function checkPending(history: ReadonlyArray<ChatTurn>): boolean {
  const lastBot = [...history].reverse().find(turn => turn.role === 'bot')
  return lastBot !== undefined && typeof lastBot.check === 'string' && lastBot.check !== ''
}

/** The recent turns as data for the prompt: the last few only, each cleaned and within its length. */
export function recentTurns(history: ReadonlyArray<ChatTurn>): ChatTurn[] {
  return history.slice(-CHAT_LIMITS.turns).flatMap(turn => {
    const text = studentText(turn.text, CHAT_LIMITS.turnChars)
    if (text === '') return []
    const check = turn.role === 'bot' && turn.check !== undefined ? studentText(turn.check, CHAT_LIMITS.checkChars) : ''
    return [check === '' ? { role: turn.role, text } : { role: turn.role, text, check }]
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
  // Not a chat reply, or nothing to show (a lead-in to a question it does not ask): failed, released, not charged.
  const answer = reply.kind === 'completed' ? readChatReply(reply.json, checkPending(turns))?.reply ?? null : null
  if (answer === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage })
    return { status: 'failed' }
  }
  // Shown only once it is recorded as delivered: that record is also what makes a retry free.
  const recorded = await env.finish(begun.replyId, { outcome: 'answered', reply: answer, usage: reply.usage })
  return recorded ? { status: 'answered', ...answer } : { status: 'failed' }
}
