// lib/ai-practice/topic-set.ts — "Quiz me on this topic": one new set of practice questions written from one notes
// topic, over an injected, already-authorized environment. The database decides the topic the student may use, the
// funding and every limit, and returns that topic's notes and the student's last questions on it
// (begin_campus_bot_topic_set). The set is then written, judged and stored exactly as a set from an upload is: the same
// output schema, the same quote-grounding checks (service.ts assessGeneratedQuestions), the same settlement rules.
import 'server-only'
import { callCampusBotModel, fitNotesPrompt, promptFits } from '@/lib/campus-bot/model-call'
import { AI_PRACTICE_LIMITS } from './contract'
import { minimumAccepted, assessGeneratedQuestions } from './service'
import { buildTopicCheckPrompt, buildTopicSetPrompt, checkLabel, confirmedLabels, TOPIC_SET_PROMPT_VERSION }
  from './topic-prompt'
import { topicPreparedSource } from './topic-source'
import type { CampusBotModelLimits } from '@/lib/campus-bot/model-call'
import type { CampusBotNoticeKind } from '@/lib/campus-bot/contract'
import type { NotesContext } from '@/lib/campus-bot/notes-context'
import type { CourseLabel } from '@/lib/campus-bot/prompts'
import type { FailureReason, FlagReason, InsufficientReason, PersonalPracticeQuestion, UsageReport } from './contract'
import type { ProviderDiagnostic, ProviderErrorCode, QuestionGenerationProvider } from './provider'
import type { TopicSetResult } from './topic-contract'
import type { TopicPrompt } from './topic-prompt'

/** Deadlines of the two calls. The reservation outlasts admission, both of these and settlement (topic-set-server.ts). */
export const TOPIC_SET_WRITE_TIMEOUT_MS = 90_000
export const TOPIC_SET_CHECK_TIMEOUT_MS = 60_000

export type TopicSetTopic = { itemId: string; title: string; number: number | null; revision: number; pinned: boolean }

export type TopicSetBegin =
  | { state: 'started'; generationId: string; writing: CampusBotModelLimits; check: CampusBotModelLimits | null
      course: CourseLabel; topic: TopicSetTopic; notes: NotesContext; previousPrompts: string[] }
  // This request was admitted before: what it became.
  | { state: 'existing'; generationId: string
      status: 'running' | 'generated' | 'insufficient_source' | 'flagged_for_review' | 'failed' }
  | { state: 'session-limit' | 'week-limit'; resetsAt: string | null }
  | { state: 'signed-out' | 'disabled' | 'request-conflict' | 'locked' | 'not-found' | 'too-short' | 'not-entitled'
      | 'pass-used' | 'busy' | 'undelivered-limit' | 'capacity' }

export type TopicSetStatus = 'generated' | 'insufficient_source' | 'flagged_for_review' | 'failed'
export type TopicSetSettlement = {
  status: TopicSetStatus
  reason: string | null
  questionSet: Record<string, unknown> | null
  usage: UsageReport | null
  checkUsage: UsageReport | null
}

export type TopicSetEnv = {
  provider: QuestionGenerationProvider | null
  begin(requestId: string, courseId: string, itemId: string): Promise<TopicSetBegin | null>
  /** Settle. The status the set was recorded with, or null when settlement did not answer. */
  finish(generationId: string, settlement: TopicSetSettlement): Promise<TopicSetStatus | null>
  notice(): Promise<CampusBotNoticeKind>
  plansOnSale(): Promise<boolean>
  /** Private operator diagnostics for every provider failure; never student-visible. */
  reportProviderProblem(code: ProviderErrorCode, diagnostic: ProviderDiagnostic): void
}

export type TopicSetRequest = { courseId: string; itemId: string; requestId: string }

/** The stored set, in the format every Campus Bot set is saved in, its source being the notes topic. */
export type TopicPracticeSet = {
  formatVersion: 1
  origin: 'ai-generated'
  visibility: 'personal'
  verification: 'unverified'
  course: CourseLabel
  source: { kind: 'notes-topic'; courseId: string; itemId: string; revision: number; title: string; number: number | null
    pinned: boolean; sha256: string; charCount: number; passageCount: number }
  questions: PersonalPracticeQuestion[]
  generation: { provider: string; model: string; promptVersion: string; confidence: 'medium' | 'high'
    requestedQuestionCount: number; rejectedQuestionCount: number; checkedBy: string | null; removedByCheck: number }
}

type Outcome =
  | { kind: 'delivered'; set: TopicPracticeSet; usage: UsageReport; checkUsage: UsageReport | null }
  | { kind: 'undelivered'; status: Exclude<TopicSetStatus, 'generated'>
      reason: FailureReason | FlagReason | InsufficientReason | 'check-failed' | 'not-configured' | 'notes-too-long'
      usage: UsageReport | null; checkUsage: UsageReport | null
      /** A provider that did not answer (a timeout, an outage): the student is told Campus Bot is busy. */
      busy: boolean }

const failed = (reason: Extract<Outcome, { kind: 'undelivered' }>['reason'], usage: UsageReport | null,
  checkUsage: UsageReport | null = null, busy = false): Outcome =>
  ({ kind: 'undelivered', status: 'failed', reason, usage, checkUsage, busy })

/** How much a cited passage is shortened by, from its end, each time a check's prompt is over its input cap. */
const CHECK_TRIM_CHARS = 2_000

/** The check's prompt within its input cap: the cited passages shortened from their ends, the longest first, if they
 *  must be (a question whose working is then cut off is simply not confirmed); null when the questions alone do not
 *  fit. */
export function checkPromptWithin(questions: ReadonlyArray<PersonalPracticeQuestion>, notes: NotesContext,
  limits: CampusBotModelLimits): TopicPrompt | null {
  const cited = new Set(questions.map(question => question.grounding.passageId))
  let passages = notes.passages.filter(passage => cited.has(passage.id))
  if (passages.length === 0) passages = [...notes.passages]
  for (;;) {
    const prompt = buildTopicCheckPrompt(questions, { passages })
    if (promptFits(prompt, limits)) return prompt
    if (passages.length === 0) return null
    const longest = passages.reduce((at, passage, index) => passage.text.length > passages[at].text.length ? index : at, 0)
    if (passages[longest].text.length === 0) return null
    passages = passages.map((passage, index) => index === longest
      ? { ...passage, text: passage.text.slice(0, Math.max(0, passage.text.length - CHECK_TRIM_CHARS)) } : passage)
  }
}

/** Write the set, and check it on a calculation course. Every outcome is a value: nothing here throws. */
async function writeSet(provider: QuestionGenerationProvider, begun: Extract<TopicSetBegin, { state: 'started' }>,
  request: TopicSetRequest, report: TopicSetEnv['reportProviderProblem']): Promise<Outcome> {
  const count = AI_PRACTICE_LIMITS.questionsPerRequest
  // The whole prompt stays within the input cap admitted: as much of the topic's notes as fits, from its start. The set
  // is grounded in, and records, exactly the passages sent. Nothing fits: no call, and nothing is charged.
  const fitted = fitNotesPrompt(begun.notes, notes => buildTopicSetPrompt(begun.course, begun.topic.title, notes,
    begun.previousPrompts), begun.writing)
  if (fitted === null) return failed('notes-too-long', null)
  const source = topicPreparedSource(fitted.notes)
  const written = await callCampusBotModel(provider, { ...fitted.prompt, limits: begun.writing, effort: 'medium',
    timeoutMs: TOPIC_SET_WRITE_TIMEOUT_MS })
  if (written.kind === 'failed') {
    report(written.code, written.diagnostic)
    return failed(written.code === 'timeout' ? 'timeout' : written.code === 'rate-limited' ? 'rate-limited'
      : 'provider-unavailable', null, null, true)
  }
  if (written.kind !== 'completed') {
    return written.kind === 'refused' ? { kind: 'undelivered', status: 'flagged_for_review', reason: 'provider-refusal',
      usage: written.usage, checkUsage: null, busy: false }
      : failed(written.kind === 'truncated' ? 'truncated-output' : 'invalid-output', written.usage)
  }
  const assessed = assessGeneratedQuestions(written.json, source, begun.topic.itemId, count, begun.previousPrompts)
  if (assessed.kind === 'insufficient-source') {
    return { kind: 'undelivered', status: 'insufficient_source', reason: assessed.reason, usage: written.usage,
      checkUsage: null, busy: false }
  }
  if (assessed.kind === 'flagged-for-review') {
    return { kind: 'undelivered', status: 'flagged_for_review', reason: assessed.reason, usage: written.usage,
      checkUsage: null, busy: false }
  }
  if (assessed.kind === 'failed') return failed(assessed.reason, written.usage)

  let questions = assessed.questions
  let checkUsage: UsageReport | null = null
  if (begun.check !== null) {
    // A calculation course: the checking model confirms each question before anyone sees it. Fails closed, a set that
    // cannot be checked within the check's input cap included.
    const checkPrompt = checkPromptWithin(questions, fitted.notes, begun.check)
    if (checkPrompt === null) return failed('check-failed', written.usage)
    const checked = await callCampusBotModel(provider, { ...checkPrompt, limits: begun.check, effort: 'medium',
      timeoutMs: TOPIC_SET_CHECK_TIMEOUT_MS })
    if (checked.kind === 'failed') {
      report(checked.code, checked.diagnostic)
      return failed('check-failed', written.usage, null, true)
    }
    checkUsage = checked.usage
    const confirmed = checked.kind === 'completed' ? confirmedLabels(checked.json) : null
    if (confirmed === null) return failed('check-failed', written.usage, checkUsage)
    questions = questions.filter((_, index) => confirmed.has(checkLabel(index)))
    if (questions.length < minimumAccepted(count)) return failed('check-failed', written.usage, checkUsage)
  }
  return { kind: 'delivered', usage: written.usage, checkUsage, set: {
    formatVersion: 1,
    origin: 'ai-generated',
    visibility: 'personal',
    verification: 'unverified',
    course: begun.course,
    source: { kind: 'notes-topic', courseId: request.courseId, itemId: begun.topic.itemId,
      revision: begun.topic.revision, title: begun.topic.title, number: begun.topic.number, pinned: begun.topic.pinned,
      sha256: source.sha256, charCount: source.charCount, passageCount: source.passages.length },
    questions,
    generation: { provider: provider.id, model: written.usage.model, promptVersion: TOPIC_SET_PROMPT_VERSION,
      confidence: assessed.confidence, requestedQuestionCount: count, rejectedQuestionCount: assessed.rejectedCount,
      checkedBy: checkUsage?.model ?? null, removedByCheck: assessed.questions.length - questions.length },
  } }
}

/** Write one set for the verified student bound into env. */
export async function runTopicSet(env: TopicSetEnv, request: TopicSetRequest): Promise<TopicSetResult> {
  const begun = await env.begin(request.requestId, request.courseId, request.itemId)
  if (begun === null) return { status: 'unavailable' }
  switch (begun.state) {
    case 'existing':
      // A retry of the same request: the set it wrote, still writing, or the failure it already recorded.
      return begun.status === 'generated' ? { status: 'ready', setId: begun.generationId }
        : begun.status === 'running' ? { status: 'in-progress' } : { status: 'failed' }
    case 'session-limit': return { status: 'limit', limit: 'session', resetsAt: begun.resetsAt }
    case 'week-limit': return { status: 'limit', limit: 'week', resetsAt: begun.resetsAt }
    case 'pass-used': return { status: 'limit', limit: 'pass', resetsAt: null }
    case 'undelivered-limit': return { status: 'limit', limit: 'undelivered', resetsAt: null }
    case 'not-entitled': return { status: 'not-entitled', notice: await env.notice() }
    case 'locked': return { status: 'locked', plansOnSale: await env.plansOnSale() }
    // Another set is being written for this student: the page waits for it, then asks again.
    case 'busy': return { status: 'in-progress' }
    case 'capacity': return { status: 'busy' }
    case 'request-conflict': return { status: 'invalid-request' }
    case 'not-found': case 'too-short': return { status: 'not-found' }
    case 'signed-out': case 'disabled': return { status: begun.state }
    case 'started': break
  }
  const provider = env.provider
  const outcome = provider === null ? failed('not-configured', null)
    : await writeSet(provider, begun, request, env.reportProviderProblem.bind(env))
  const settlement: TopicSetSettlement = outcome.kind === 'delivered'
    ? { status: 'generated', reason: null, questionSet: JSON.parse(JSON.stringify(outcome.set)) as Record<string, unknown>,
        usage: outcome.usage, checkUsage: outcome.checkUsage }
    : { status: outcome.status, reason: outcome.reason, questionSet: null, usage: outcome.usage,
        checkUsage: outcome.checkUsage }
  const recorded = await env.finish(begun.generationId, settlement)
  // The student sees what the ledger recorded: a set is never shown unless it was accounted as delivered.
  if (recorded === null) return { status: 'unavailable' }
  if (recorded === 'generated') return { status: 'ready', setId: begun.generationId }
  if (provider === null) return { status: 'disabled' }
  return outcome.kind === 'undelivered' && outcome.busy ? { status: 'busy' } : { status: 'failed' }
}
