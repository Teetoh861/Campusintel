// lib/campus-bot/ask.ts — One Ask Campus Bot reply about the topic a student is reading, over an injected, already
// authorized environment. The database decides the topic the student may ask about, the funding and the limits, and
// returns that topic's notes and nothing else (begin_campus_bot_chat): no question bank or answer key is ever in
// reach of a chat. The chat itself lives in the page; what arrives here is the new message and a few recent turns.
// Two buttons under a reply are chat requests too (owner decisions B5 and B6): Explain again, a reply to a fixed message
// that is never marked, and Make flashcards, cards written from the topic's notes alone.
import 'server-only'
import { CHAT_LIMITS } from './contract'
import { readFlashcards } from './flashcards'
import { callCampusBotModel, fitNotesPrompt } from './model-call'
import { buildAskPrompt, buildFlashcardsPrompt, EXPLAIN_AGAIN_MESSAGE } from './prompts'
import { announcesQuestion, answerLeak, asksTwoQuestions, BOLD_MAX, BOLD_MAX_MEMORY_TRICK, boldTerms, capWords,
  comparable, containsAnswer, echoLeak, hasEmoji, hasStressCapitals, isLeadIn, lowerStressCapitals, mentionsChat,
  mentionsCheck, offersSameOptionTwice, removeSentences,
  markTerms, oneSentence, plainText, REPLY_WORDS, stripCheckInstruction, stripCheckLabel, stripLeadingVerdict,
  studentText, trickLettersMatch, wholeWordCount } from './reply-text'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { AskResult, CampusBotNoticeKind, ChatAction, ChatVerdict, Flashcard } from './contract'
import type { CampusBotModelLimits } from './model-call'
import type { NotesContext } from './notes-context'
import type { ChatTurn, CourseLabel } from './prompts'

/** Deadline of the one call; the reservation outlasts admission, this and settlement. */
export const CHAT_TIMEOUT_MS = 25_000

/** A reply as the student sees it and the database keeps it. The check question's answer is never part of it. */
export type ChatReply = { text: string; inNotes: boolean; verdict: ChatVerdict; check: string | null
  memoryTrick: string | null }
/** Flashcards as the database keeps them. */
export type KeptFlashcards = { cards: Flashcard[] }

export type AskBegin =
  | { state: 'started'; replyId: string; limits: CampusBotModelLimits; course: CourseLabel; topicTitle: string
      notes: NotesContext }
  // This message was already answered: the reply (or flashcards) while it is kept, null once it has been deleted.
  | { state: 'answered'; reply: ChatReply | KeptFlashcards | null }
  | { state: 'session-limit' | 'week-limit'; resetsAt: string | null }
  | { state: 'signed-out' | 'disabled' | 'not-found' | 'exam-open' | 'locked' | 'not-entitled' | 'busy'
      | 'undelivered-limit' | 'pass-limit' | 'capacity' }

export type AskSettlement =
  | { outcome: 'answered'; reply: ChatReply; usage: UsageReport }
  | { outcome: 'flashcards'; cards: Flashcard[]; usage: UsageReport }
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
  history: ReadonlyArray<ChatTurn>; action?: ChatAction }

/** Which server guard changed what the model wrote: kept for the human review, never shown or stored. */
export type ChatGuard = 'emoji-removed' | 'verdict-without-check' | 'in-notes-set' | 'verdict-word-removed'
  | 'check-label-removed' | 'check-instruction-removed' | 'check-without-answer' | 'check-answer-leaked'
  | 'memory-trick-gave-answer' | 'check-echoes-reply' | 'memory-trick-echoes-check' | 'memory-trick-unmatched-bold-dropped'
  | 'lead-in-without-check' | 'explain-again-verdict-removed' | 'explain-again-check-removed'
  | 'explain-again-mentions-chat' | 'reply-ellipsis' | 'reply-check-mention-removed' | 'check-contains-answer'
  | 'check-stress-capitals' | 'check-stress-capitals-lowered' | 'check-two-questions'
  | 'check-repeats-answer' | 'memory-trick-not-one-sentence'
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
 * - a memory trick whose bold first letters do not match (each bolded at least twice) is dropped;
 * - a check question loses any label it opened with (the page adds its own) and any final instruction ("Answer with a
 *   single word."): the question itself asks;
 * - a check question without an answer is dropped;
 * - the answer's words the question does not already hold (answerLeak): all of them in the reply drops the check
 *   question; all of them only in the memory trick drops the memory trick;
 * - a question that offers its own answer (echoLeak): one sentence of the reply with the answer and another key word
 *   of the question drops the check question ("/s/ is voiceless" then "Is /s/ voiced or voiceless?"); one sentence of
 *   the memory trick alone drops the memory trick;
 * - the check question and the memory trick are plain text within their limits, or dropped.
 * Last, the reply and the memory trick get their bold terms back (at most BOLD_MAX, or BOLD_MAX_MEMORY_TRICK in a memory
 * trick, in order); a field whose markers do not pair up, are too many, or no longer fit, is shown without any. The check question's answer
 * is read here and nowhere else: it is never returned, stored or logged. The same reading serves the student and the
 * human review, which also reads which guards fired, what they removed and the bold terms. A reply with an ellipsis
 * is no reply (a model thinking aloud). A memory trick that is not one plain sentence, or whose bold first letters do
 * not pair up, is dropped. A check question is dropped when it asks two questions, holds its own answer twice, or is
 * an open question (no options) that holds every word of its answer (a hyphenated compound is one word in both), and it
 * is always plain text: any bold goes. A word in it that marks stress with capitals ("REcord") is written in lower case,
 * and the check goes only when that leaves the same option twice ("REcord or reCORD"). A reply loses each sentence about the check
 * question ("…, the check question is about the same branch."), except a lead-in to the check question it shows
 * ("Here's a quick check."), and, when it shows no check question, a last sentence that announces one ("Next, let's
 * check how voicing works."); a reply with nothing left is no reply.
 *
 * A reply to Explain again (`explainAgain`) is never marked: its verdict is 'none', whatever the model wrote. It fails
 * when it talks about the chat ("Your last reply…"), and it never has a check question: one the model writes goes, and
 * a question that was waiting ends.
 */
export function readChatReply(json: unknown, pending: boolean, explainAgain = false):
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
  // Explain again never has a check question.
  const checkField = field(explainAgain ? '' : rawCheck, true, BOLD_MAX)
  const trickField = field(rawTrick, true, BOLD_MAX_MEMORY_TRICK)
  if (replyField.emoji || checkField.emoji || trickField.emoji || hasEmoji(rawCheck) || hasEmoji(checkAnswer)) {
    guards.push('emoji-removed')
  }
  if (explainAgain && plainText(rawCheck) !== '') guards.push('explain-again-check-removed')
  let verdict = rawVerdict as ChatVerdict
  if (verdict !== 'none' && explainAgain) {
    verdict = 'none'
    guards.push('explain-again-verdict-removed')
  } else if (verdict !== 'none' && !pending) {
    verdict = 'none'
    guards.push('verdict-without-check')
  }
  let inNotes = rawInNotes
  if (verdict !== 'none' && !inNotes) {
    inNotes = true
    guards.push('in-notes-set')
  }
  // An ellipsis in what the model wrote: a reply thinking aloud ("Ghana gives up only 1 oil? No, simpler: ..."), unusable.
  if (/\.\.\.|…/.test(replyField.plain)) return { reply: null, guards: [...guards, 'reply-ellipsis'], removed }
  // Explain again about the chat rather than the topic ("Your last reply said…"): unusable in the same way.
  if (explainAgain && mentionsChat(replyField.plain)) {
    return { reply: null, guards: [...guards, 'explain-again-mentions-chat'], removed }
  }
  let text = capWords(replyField.plain, REPLY_WORDS.chat.ceiling)
  if (verdict !== 'none') {
    const unmarked = stripLeadingVerdict(text)
    if (unmarked.stripped) guards.push('verdict-word-removed')
    text = unmarked.text
  }
  if (text === '') return null
  // A sentence about the check question itself: the app shows the question, so the reply never talks about it. A lead-in
  // that names it ("Here's a quick check.") stays while the question is shown, so it waits for the check guards, which
  // read the reply without it.
  const withLeadIns = removeSentences(text, sentence => mentionsCheck(sentence) && !isLeadIn(sentence))
  if (withLeadIns.removed > 0) {
    guards.push('reply-check-mention-removed')
    if (withLeadIns.text === '') return { reply: null, guards, removed }
  }
  const unmentioned = removeSentences(withLeadIns.text, mentionsCheck)
  text = unmentioned.text
  let memoryTrick: string | null = trickField.plain.length <= CHAT_LIMITS.memoryTrickChars ? trickField.plain : null
  if (memoryTrick === null) {
    guards.push('memory-trick-too-long')
    removed.memoryTrick = trickField.plain
  } else if (memoryTrick !== '' && !oneSentence(memoryTrick)) {
    guards.push('memory-trick-not-one-sentence')
    removed.memoryTrick = memoryTrick
    memoryTrick = null
  }
  // Bold first letters that do not pair up: the trick is nonsense ("**P**ositive is what **I**s testable"), dropped.
  const trickTerms = trickField.terms
  if (memoryTrick !== null && memoryTrick !== '' && trickTerms !== null && !trickLettersMatch(trickTerms)) {
    guards.push('memory-trick-unmatched-bold-dropped')
    removed.memoryTrick = memoryTrick
    memoryTrick = null
  }
  let check: string | null = null
  const unlabelled = stripCheckLabel(checkField.plain)
  const instructed = stripCheckInstruction(unlabelled.text)
  const labelled = { text: instructed.text }
  if (labelled.text !== '') {
    if (unlabelled.stripped) guards.push('check-label-removed')
    if (instructed.stripped) guards.push('check-instruction-removed')
    const answer = plainText(checkAnswer)
    // Stress marked with capitals ("REcord") means nothing to a student: the word is written in lower case and the check
    // kept, unless that leaves the same option twice ("REcord or reCORD" would read "record or record").
    const lowered = hasStressCapitals(labelled.text) ? lowerStressCapitals(labelled.text) : null
    if (labelled.text.length > CHAT_LIMITS.checkChars) guards.push('check-too-long')
    else if (comparable(answer) === '') guards.push('check-without-answer')
    else if (asksTwoQuestions(labelled.text)) guards.push('check-two-questions')
    else if (lowered !== null && offersSameOptionTwice(lowered)) guards.push('check-stress-capitals')
    else {
      if (lowered !== null) {
        labelled.text = lowered
        guards.push('check-stress-capitals-lowered')
      }
      if (wholeWordCount(labelled.text, answer) > 1) guards.push('check-repeats-answer')
      else if (containsAnswer(answer, labelled.text)) guards.push('check-contains-answer')
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
    }
    if (check === null) removed.check = labelled.text
  }
  if (check !== null) text = withLeadIns.text
  else {
    // With no check question shown, a lead-in that names it goes too, and a last sentence that announces one ("Next,
    // let's check…") promises a question that is not there.
    const unannounced = removeSentences(text, announcesQuestion, { lastOnly: true })
    if (unmentioned.removed + unannounced.removed > 0) {
      if (!guards.includes('reply-check-mention-removed')) guards.push('reply-check-mention-removed')
      text = unannounced.text
      if (text === '') return { reply: null, guards, removed }
    }
  }
  // The bold terms back, in the reply and the memory trick, each on its own. A check question stays plain text: bold on
  // an option gives the answer away, by pointing at it or by elimination.
  const shown = remark(text, replyField.terms, 4_000)
  if (shown.removed) guards.push('reply-bold-removed')
  if (check !== null && rawCheck.includes('**')) guards.push('check-bold-removed')
  let finalTrick = memoryTrick || null
  if (finalTrick !== null) {
    const marked = remark(finalTrick, trickTerms, CHAT_LIMITS.memoryTrickChars)
    if (marked.removed) guards.push('memory-trick-bold-removed')
    finalTrick = marked.text
  }
  // A reply that only promises a question it then does not ask leaves the student nothing to answer: it is no reply.
  if (check === null && isLeadIn(text)) return { reply: null, guards: [...guards, 'lead-in-without-check'], removed }
  return { reply: { text: shown.text, inNotes, verdict, check, memoryTrick: finalTrick }, guards, removed }
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
  // A button's request asks what the server decides; the words the page sent with it are never used.
  const message = command.action === 'explain-again' ? EXPLAIN_AGAIN_MESSAGE
    : command.action === 'flashcards' ? '' : studentText(command.message, CHAT_LIMITS.messageChars)
  if (message === '' && command.action !== 'flashcards') return { status: 'invalid-request' }
  const begun = await env.begin(command.requestId, command.courseId, command.itemId, env.provider !== null)
  if (begun === null) return { status: 'unavailable' }
  if (begun.state === 'answered') {
    // A retry of a message already answered is free while the reply is kept. After that there is nothing to show,
    // and trying the same message again cannot help: the student asks again, as a new message. A kept reply of the
    // other kind (flashcards for a message, or a reply for Make flashcards) is not this request's.
    const kept = begun.reply
    if (kept === null || ('cards' in kept) !== (command.action === 'flashcards')) return { status: 'not-found' }
    return 'cards' in kept ? { status: 'flashcards', cards: kept.cards } : { status: 'answered', ...kept }
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

  if (command.action === 'flashcards') return makeFlashcards(env, begun, provider)

  // The whole prompt stays within the input cap admitted: as much of the topic's notes as fits.
  const turns = recentTurns(command.history)
  const explainAgain = command.action === 'explain-again'
  const fitted = fitNotesPrompt(begun.notes,
    notes => buildAskPrompt(begun.course, begun.topicTitle, notes, turns, message, explainAgain), begun.limits)
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
  const answer = reply.kind === 'completed'
    ? readChatReply(reply.json, checkPending(turns), explainAgain)?.reply ?? null : null
  if (answer === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage })
    return { status: 'failed' }
  }
  // Shown only once it is recorded as delivered: that record is also what makes a retry free.
  const recorded = await env.finish(begun.replyId, { outcome: 'answered', reply: answer, usage: reply.usage })
  return recorded ? { status: 'answered', ...answer } : { status: 'failed' }
}

/** Make flashcards: one call with the topic's notes and nothing of the chat, read through the flashcards guards. Fewer
 *  than 4 cards left, or no usable answer, is a failed reply: released and not charged. */
async function makeFlashcards(env: AskEnv, begun: Extract<AskBegin, { state: 'started' }>,
  provider: QuestionGenerationProvider): Promise<AskResult> {
  const fitted = fitNotesPrompt(begun.notes, notes => buildFlashcardsPrompt(begun.course, begun.topicTitle, notes),
    begun.limits)
  if (fitted === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: null })
    return { status: 'failed' }
  }
  const reply = await callCampusBotModel(provider, { ...fitted.prompt, limits: begun.limits, effort: 'low',
    timeoutMs: CHAT_TIMEOUT_MS })
  if (reply.kind === 'failed') {
    env.reportProviderProblem(reply.code, reply.diagnostic)
    await env.finish(begun.replyId, { outcome: 'failed', usage: null })
    return { status: 'busy' }
  }
  // Grounded in the notes that were sent: a passage left off to fit the cap does not count.
  const read = reply.kind === 'completed' ? readFlashcards(reply.json, fitted.notes) : null
  if (read === null || read.cards.length === 0) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage })
    return { status: 'failed' }
  }
  const recorded = await env.finish(begun.replyId, { outcome: 'flashcards', cards: read.cards, usage: reply.usage })
  return recorded ? { status: 'flashcards', cards: read.cards } : { status: 'failed' }
}
