// lib/campus-bot/explain.ts — One explanation of a question the student has finished, over an injected, already
// authorized environment. The database decides everything that matters before a word is written: that the question is
// one this student may have explained, whether an explanation is already saved for everyone, the funding, the limits
// and the notes (begin_campus_bot_explanation). This file writes the explanation, has it checked on a calculation
// course, and reports back; the student is shown only what the database then saved.
import 'server-only'
import { callCampusBotModel, fitNotesPrompt, promptFits } from './model-call'
import { passageById } from './notes-context'
import { buildExplainCheckPrompt, buildExplainPrompt } from './prompts'
import { capWords, namesAnotherOption, plainText, REPLY_WORDS } from './reply-text'
import type { UsageReport } from '@/lib/ai-practice/contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { CampusBotNoticeKind, ExplainResult, TopicLink } from './contract'
import type { CampusBotModelLimits } from './model-call'
import type { NotesContext, NotesPassage } from './notes-context'
import type { CourseLabel, ExplainQuestion } from './prompts'

/** Deadlines of the two calls. The reservation (reply_reservation_seconds, 180 at least 120) outlasts admission,
 *  both calls and settlement: 15 + 25 + 35 + 30 seconds. */
export const EXPLAIN_WRITE_TIMEOUT_MS = 25_000
export const EXPLAIN_CHECK_TIMEOUT_MS = 35_000

/** A saved explanation as the database returns it. */
export type SavedExplanation =
  | { outcome: 'explained'; body: string; topic: TopicLink | null }
  | { outcome: 'not-covered' }
  | { outcome: 'check-failed'; topic: TopicLink | null }

export type ExplainBegin =
  | { state: 'started'; replyId: string; limits: CampusBotModelLimits; check: CampusBotModelLimits | null
      course: CourseLabel; question: ExplainQuestion; notes: NotesContext }
  | { state: 'saved'; saved: SavedExplanation }
  | { state: 'session-limit' | 'week-limit'; resetsAt: string | null }
  | { state: 'signed-out' | 'disabled' | 'not-found' | 'not-answered' | 'exam-open' | 'locked' | 'not-entitled' | 'busy'
      | 'undelivered-limit' | 'pass-limit' | 'capacity' }

export type ExplainSettlement =
  | { outcome: 'explained'; body: string; topicItemId: string; usage: UsageReport; checkUsage: UsageReport | null }
  | { outcome: 'not-covered'; usage: UsageReport }
  | { outcome: 'check-failed'; topicItemId: string; usage: UsageReport; checkUsage: UsageReport | null }
  | { outcome: 'failed'; usage: UsageReport | null; checkUsage: UsageReport | null }

export type ExplainEnv = {
  /** Null when no provider is configured: saved explanations are still served, nothing new is written. */
  provider: QuestionGenerationProvider | null
  begin(attemptId: string, questionId: string, generate: boolean): Promise<ExplainBegin | null>
  /** Settle and save. The saved explanation, 'failed' when nothing was saved, or null when the answer cannot be read. */
  finish(replyId: string, settlement: ExplainSettlement): Promise<SavedExplanation | 'failed' | null>
  /** Which line a student without Campus Bot reads, and the sales switch for a course no longer included. */
  notice(): Promise<CampusBotNoticeKind>
  plansOnSale(): Promise<boolean>
  /** Private operator diagnostics for a provider failure; never student-visible. */
  reportProviderProblem(code: ProviderErrorCode, diagnostic: ProviderDiagnostic): void
}

function shown(saved: SavedExplanation): ExplainResult {
  if (saved.outcome === 'explained') return { status: 'explained', text: saved.body, topic: saved.topic }
  if (saved.outcome === 'check-failed') return { status: 'check-failed', topic: saved.topic }
  return { status: 'not-covered' }
}

/** What the writer's reply amounts to: an explanation (plain text, within its length) and the passage it relied on;
 *  the notes not covering the question; or a reply that cannot be used (not the shape asked for, or one that names
 *  another option as correct). The same reading serves the student and the human review. */
export type ReadExplanation =
  | { kind: 'explained'; text: string; passage: NotesPassage & { topicItemId: string } }
  | { kind: 'not-covered' }
  | { kind: 'unusable' }

export function readExplanation(json: unknown, notes: NotesContext, question: ExplainQuestion): ReadExplanation {
  if (typeof json !== 'object' || json === null) return { kind: 'unusable' }
  const { supported, passage: cited, explanation } = json as Record<string, unknown>
  if (typeof supported !== 'boolean' || typeof cited !== 'string' || typeof explanation !== 'string') {
    return { kind: 'unusable' }
  }
  const passage = passageById(notes, cited)
  const text = capWords(plainText(explanation), REPLY_WORDS.explain.ceiling)
  if (!supported || passage === null || passage.topicItemId === null || text === '') return { kind: 'not-covered' }
  if (namesAnotherOption(text, question.correctOption, question.options.length)) return { kind: 'unusable' }
  return { kind: 'explained', text, passage: { ...passage, topicItemId: passage.topicItemId } }
}

/** The checking model's verdict, or null when its reply is not one. */
export function readVerdict(json: unknown): 'pass' | 'fail' | null {
  if (typeof json !== 'object' || json === null) return null
  const value = (json as Record<string, unknown>).verdict
  return value === 'pass' || value === 'fail' ? value : null
}

/** The check's prompt within its input cap: the cited passage shortened from its end if it must be; null when even
 *  the question and the explanation alone do not fit. */
function checkPromptWithin(question: ExplainQuestion, passage: NotesPassage, text: string, limits: CampusBotModelLimits) {
  let notes = passage.text
  for (;;) {
    const prompt = buildExplainCheckPrompt(question, { ...passage, text: notes }, text)
    if (promptFits(prompt, limits)) return prompt
    if (notes.length === 0) return null
    notes = notes.slice(0, Math.max(0, notes.length - 2_000))
  }
}

/** Explain one question for the verified student bound into env. Every outcome is a value. */
export async function explainQuestion(env: ExplainEnv, command: { attemptId: string; questionId: string }):
  Promise<ExplainResult> {
  const begun = await env.begin(command.attemptId, command.questionId, env.provider !== null)
  if (begun === null) return { status: 'unavailable' }
  if (begun.state === 'saved') return shown(begun.saved)
  if (begun.state === 'session-limit' || begun.state === 'week-limit') {
    return { status: 'limit', limit: begun.state === 'session-limit' ? 'session' : 'week', resetsAt: begun.resetsAt }
  }
  if (begun.state === 'pass-limit') return { status: 'limit', limit: 'pass', resetsAt: null }
  if (begun.state === 'undelivered-limit') return { status: 'limit', limit: 'undelivered', resetsAt: null }
  if (begun.state === 'not-entitled') return { status: 'not-entitled', notice: await env.notice() }
  if (begun.state === 'locked') return { status: 'locked', plansOnSale: await env.plansOnSale() }
  // Another request is writing this explanation, or this student's last one is still being written.
  if (begun.state === 'busy') return { status: 'in-progress' }
  if (begun.state === 'capacity') return { status: 'busy' }
  // A question this student has not finished reads like one that does not exist: nothing about it is confirmed.
  if (begun.state === 'not-answered') return { status: 'not-found' }
  if (begun.state !== 'started') return { status: begun.state }
  const provider = env.provider
  if (provider === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: null, checkUsage: null })
    return { status: 'disabled' }
  }

  const { question } = begun
  // The whole prompt stays within the input cap admitted: as many of the passages as fit.
  const fitted = fitNotesPrompt(begun.notes, notes => buildExplainPrompt(begun.course, question, notes), begun.limits)
  if (fitted === null) {
    await env.finish(begun.replyId, { outcome: 'failed', usage: null, checkUsage: null })
    return { status: 'failed' }
  }
  const { notes, prompt } = fitted
  const reply = await callCampusBotModel(provider, { ...prompt, limits: begun.limits, effort: 'low',
    timeoutMs: EXPLAIN_WRITE_TIMEOUT_MS })
  if (reply.kind === 'failed') {
    env.reportProviderProblem(reply.code, reply.diagnostic)
    await env.finish(begun.replyId, { outcome: 'failed', usage: null, checkUsage: null })
    return { status: 'busy' }
  }
  const failed = async (checkUsage: UsageReport | null = null): Promise<ExplainResult> => {
    await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage, checkUsage })
    return { status: 'failed' }
  }
  if (reply.kind !== 'completed') return failed()
  const output = readExplanation(reply.json, notes, question)
  if (output.kind === 'unusable') return failed()
  // The notes do not support an explanation: said briefly, saved, and charged nothing.
  if (output.kind === 'not-covered') {
    const saved = await env.finish(begun.replyId, { outcome: 'not-covered', usage: reply.usage })
    return saved === null || saved === 'failed' ? { status: 'failed' } : shown(saved)
  }
  const { text, passage } = output

  let checkUsage: UsageReport | null = null
  if (begun.check !== null) {
    // A calculation course: the stronger model reads the working once, before the explanation is saved for anyone.
    const checkPrompt = checkPromptWithin(question, passage, text, begun.check)
    const check = checkPrompt === null
      // The working cannot be checked within the check's cap: treated as not passed, so nothing generated is shown.
      ? { kind: 'invalid' as const, usage: null }
      : await callCampusBotModel(provider, { ...checkPrompt, limits: begun.check, effort: 'medium',
        timeoutMs: EXPLAIN_CHECK_TIMEOUT_MS })
    if (check.kind === 'failed') {
      // No verdict at all (a timeout or an outage) is not a failed check: nothing is saved, so the next try checks again.
      env.reportProviderProblem(check.code, check.diagnostic)
      await env.finish(begun.replyId, { outcome: 'failed', usage: reply.usage, checkUsage: null })
      return { status: 'busy' }
    }
    checkUsage = check.usage
    if (check.kind !== 'completed' || readVerdict(check.json) !== 'pass') {
      // Not passed: no generated explanation is shown. The student gets the notes topic and the official answer.
      const saved = await env.finish(begun.replyId, { outcome: 'check-failed', topicItemId: passage.topicItemId,
        usage: reply.usage, checkUsage })
      return saved === null || saved === 'failed' ? { status: 'failed' } : shown(saved)
    }
  }
  const saved = await env.finish(begun.replyId, { outcome: 'explained', body: text, topicItemId: passage.topicItemId,
    usage: reply.usage, checkUsage })
  // The student sees what was saved, so an explanation is never shown unless it was accounted as delivered.
  return saved === null || saved === 'failed' ? { status: 'failed' } : shown(saved)
}
