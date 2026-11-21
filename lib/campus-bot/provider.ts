// lib/campus-bot/provider.ts — The provider Explain and Ask Campus Bot call: the configured Claude adapter, or, on a
// developer's own machine only, a scripted stand-in so every screen state can be checked in a browser without a
// provider call. The stand-in needs CAMPUS_BOT_FAKE_PROVIDER=true and a positively verified local environment
// (lib/ai-practice/entitlement.ts isVerifiedLocalEnvironment): every `next build` / `next start`, and every hosted
// deployment, ignores the variable.
import 'server-only'
import { readFileSync } from 'node:fs'
import { createConfiguredProvider, readAiPracticeConfig } from '@/lib/ai-practice/config'
import { isVerifiedLocalEnvironment } from '@/lib/ai-practice/entitlement'
import { ProviderError } from '@/lib/ai-practice/provider'
import type { ProviderRequest, ProviderResponse, QuestionGenerationProvider, TokenUsage } from '@/lib/ai-practice/provider'

type Env = Readonly<Record<string, string | undefined>>

export function fakeCampusBotProviderAllowed(env: Env = process.env): boolean {
  return env.CAMPUS_BOT_FAKE_PROVIDER === 'true' && isVerifiedLocalEnvironment(env)
}

/** What the stand-in does next, per kind of call. Read from the JSON file CAMPUS_BOT_FAKE_SCRIPT names on every call,
 *  so a browser check changes it between steps; anything missing or unreadable means the plain successful reply. */
export type FakeScript = {
  explain?: 'ok' | 'not-covered' | 'wrong-option' | 'long' | 'invalid' | 'refused' | 'timeout'
  check?: 'pass' | 'fail' | 'timeout'
  chat?: 'ok' | 'outside' | 'long' | 'invalid' | 'refused' | 'timeout'
  /** Quiz me on this topic: five questions grounded in the notes given, too few of them, or a failure. */
  set?: 'ok' | 'few' | 'invalid' | 'refused' | 'timeout'
  /** The check of a set on a calculation course: every question passes, the first fails, all fail, or no answer. */
  setCheck?: 'pass' | 'drop-one' | 'fail' | 'timeout'
}
type FakeKind = keyof FakeScript

function readScript(path: string | undefined): FakeScript {
  if (!path) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as FakeScript : {}
  } catch { return {} }
}

// Illustrative figures, close to the estimates in lib/ai-practice/README.md; never measurements.
const USAGE: Record<FakeKind, TokenUsage> = {
  explain: { inputTokens: 3_300, outputTokens: 400, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  check: { inputTokens: 1_700, outputTokens: 700, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  chat: { inputTokens: 6_000, outputTokens: 350, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  set: { inputTokens: 6_150, outputTokens: 3_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  setCheck: { inputTokens: 4_200, outputTokens: 1_800, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
}
const LONG = Array.from({ length: 60 }, (_, index) => `Sentence ${index + 1} repeats the point from the notes.`).join(' ')

function kindOf(request: ProviderRequest): FakeKind {
  const required = (request.outputSchema as { required?: unknown }).required
  const keys = Array.isArray(required) ? required : []
  return keys.includes('verdict') ? 'check' : keys.includes('inNotes') ? 'chat' : keys.includes('questions') ? 'set'
    : keys.includes('results') ? 'setCheck' : 'explain'
}

const QUOTE_WORDS = 12
const KEY_WORDS = 6
const SET_SIZE = 5
const DISTRACTORS = ['A point from another topic', 'A rule these notes never give', 'An idea the notes reject']

/** Five questions whose quotes are words of the passages given, as the sets' validation requires (validate.ts). A set
 *  written after earlier ones numbers its questions on, so it never repeats them. */
function fakeSet(user: string, few: boolean): Record<string, unknown> {
  const passages = [...user.matchAll(/<passage id="(N\d+)" topic="[^"]*" heading="([^"]*)">\n([\s\S]*?)\n<\/passage>/g)]
    .map(match => ({ id: match[1]!, heading: match[2]!, words: match[3]!.split(/\s+/).filter(Boolean) }))
    .filter(passage => passage.words.length >= QUOTE_WORDS)
  const asked = /<asked_before>\n([\s\S]*?)\n<\/asked_before>/.exec(user)?.[1]?.split('\n').length ?? 0
  const round = Math.floor(asked / SET_SIZE) + 1
  const questions = passages.length === 0 ? [] : Array.from({ length: few ? 2 : SET_SIZE }, (_, index) => {
    const passage = passages[index % passages.length]!
    const use = Math.floor(index / passages.length)
    const start = Math.min(use * QUOTE_WORDS, passage.words.length - QUOTE_WORDS)
    const quote = passage.words.slice(start, start + QUOTE_WORDS).join(' ')
    const key = passage.words.slice(start, start + KEY_WORDS).join(' ')
    const correct = index % 4
    const options = [...DISTRACTORS]
    options.splice(correct, 0, key)
    return { prompt: `Set ${round}, question ${index + 1}: which words open this part of the notes on ${passage.heading}?`,
      options, correctOptionIndex: correct, explanation: `The notes on ${passage.heading} say: “${quote}”.`,
      section: passage.heading.slice(0, 120), sourcePassageId: passage.id, sourceQuote: quote }
  })
  return { assessment: { sufficientMaterial: true, relatedToCourse: true, appropriate: true, confidence: 'high',
    assessmentNote: 'Scripted set.' }, questions }
}

function fakeSetCheck(user: string, mode: 'pass' | 'drop-one' | 'fail'): Record<string, unknown> {
  const labels = [...user.matchAll(/<question label="(Q\d+)">/g)].map(match => match[1]!)
  return { results: labels.map((question, index) => ({ question,
    correct: mode === 'pass' || (mode === 'drop-one' && index > 0) })) }
}

/** A scripted provider with the adapter's interface. It never touches the network. */
export function createFakeCampusBotProvider(script: () => FakeScript = () => ({})): QuestionGenerationProvider {
  return {
    id: 'anthropic',
    model: 'claude-haiku-5-5',
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      const kind = kindOf(request)
      const mode = script()[kind] ?? (kind === 'check' || kind === 'setCheck' ? 'pass' : 'ok')
      const model = request.model ?? 'claude-haiku-5-5'
      const usage = USAGE[kind]
      if (mode === 'timeout') throw new ProviderError('timeout')
      if (mode === 'refused') return { kind: 'refused', model, usage }
      if (mode === 'invalid') return { kind: 'completed', text: 'not json', model, usage }
      if (kind === 'check') return { kind: 'completed', text: JSON.stringify({ verdict: mode }), model, usage }
      if (kind === 'set') return { kind: 'completed', text: JSON.stringify(fakeSet(request.user, mode === 'few')), model, usage }
      if (kind === 'setCheck') {
        const verdicts = mode === 'drop-one' || mode === 'fail' ? mode : 'pass'
        return { kind: 'completed', text: JSON.stringify(fakeSetCheck(request.user, verdicts)), model, usage }
      }
      if (kind === 'chat') {
        const reply = mode === 'long' ? LONG : mode === 'outside'
          ? 'Your notes for this topic do not go into that. In general, it is the idea that a firm weighs the cost of a choice against what it gives up.'
          : 'Your notes put it this way: the main idea of this topic is stated in its first lesson, and each later lesson builds on it. Would you like a quick question to check it?'
        return { kind: 'completed', text: JSON.stringify({ inNotes: mode !== 'outside', reply }), model, usage }
      }
      const passage = /<passage id="(N\d+)"/.exec(request.user)?.[1] ?? 'N1'
      const official = /Official correct option: ([A-H])/.exec(request.user)?.[1] ?? 'A'
      const other = official === 'A' ? 'B' : 'A'
      const explanation = mode === 'long' ? LONG : mode === 'wrong-option' ? `The correct answer is ${other}.`
        : `Option ${official} is right because your notes state the rule this question tests, and the other options leave part of it out.`
      return { kind: 'completed', model, usage, text: JSON.stringify(mode === 'not-covered'
        ? { supported: false, passage: '', explanation: '' } : { supported: true, passage, explanation }) }
    },
  }
}

/** The provider for a Campus Bot reply, or null when nothing can be written (saved explanations are still served). */
export function campusBotProvider(env: Env = process.env): QuestionGenerationProvider | null {
  if (fakeCampusBotProviderAllowed(env)) return createFakeCampusBotProvider(() => readScript(env.CAMPUS_BOT_FAKE_SCRIPT))
  return createConfiguredProvider(readAiPracticeConfig(env))
}
