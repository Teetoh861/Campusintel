// lib/ai-practice/parser-process.ts — Runs extract-parser.cjs as a disposable child process under a deadline,
// a resident-memory budget and a two-slot pool. A slot is freed only once its parser and sampler are confirmed dead.
import 'server-only'
import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { errorMessage, killAll, supervise } from './child-supervision'
import { AI_PRACTICE_LIMITS } from './contract'
import type { ExtractionResult } from './extract'
import { liveSamplers, MEMORY_SAMPLE_MS, MEMORY_SAMPLE_TIMEOUT_MS, startSample } from './memory-sampler'
import type { MemorySample } from './memory-sampler'

export { measureResidentBytes, parserProbes } from './memory-sampler'

/** Raw text beyond this is refused before normalization; the source cap is applied afterwards. */
export const MAX_RAW_TEXT_CHARS = AI_PRACTICE_LIMITS.maxRequestTextChars
const MAX_PDF_PAGES = 300
const MAX_DOCX_XML_BYTES = 16 * 1024 * 1024
// A real document.xml compresses roughly 5-15x; far higher ratios indicate a decompression bomb.
const MAX_DOCX_COMPRESSION_RATIO = 100

export type ParserKind = 'pdf' | 'docx'
/**
 * Why a parse ended; 'ok' covers every answer the parser gave, including a rejection. 'unmonitored' means its
 * memory could not be measured, and 'uncontained' that it or its memory sampler did not die when killed; both
 * answer 'unavailable'.
 */
export type ParseOutcome = 'ok' | 'timeout' | 'memory' | 'crashed' | 'unavailable' | 'unmonitored' | 'uncontained'
export type ParseReport = { result: ExtractionResult; outcome: ParseOutcome; elapsedMs: number; peakResidentBytes: number }

/** Limits for one parse. Tests tighten them; production uses PARSER_DEFAULTS. */
export type ParserLimits = {
  /** Wall clock from spawning the parser to its answer, covering start-up, module loading and every page. */
  timeoutMs: number
  /** V8 old-generation heap of the parser process; V8 aborts that process, and only it, beyond this. */
  maxHeapMb: number
  /** Resident memory of the whole parser process (heap, buffers, code), sampled from this process. */
  maxResidentBytes: number
  /** How long a parse may wait for a free parser before the request is answered 'unavailable'. */
  queueWaitMs: number
}

const PARSER_DEFAULTS: ParserLimits = {
  timeoutMs: 20_000,
  maxHeapMb: 160,
  maxResidentBytes: 320 * 1024 * 1024,
  queueWaitMs: 10_000,
}
// Per server process. A third request waits for a slot; beyond the queue it is answered at once.
const MAX_CONCURRENT_PARSERS = 2
const MAX_QUEUED_PARSES = 8
// SIGKILL cannot be caught, so the exit normally follows within milliseconds. Past this the parser or its
// sampler is uncontained: the request is answered, but the slot stays held while the kill is retried.
const PARSER_EXIT_GRACE_MS = 2_000
// Enough of the parser's stderr to recognise a V8 abort or a missing module; the rest is discarded.
const STDERR_TAIL_CHARS = 4_096

// Resolved from the project root at run time: next.config.mjs traces this file and its dependencies into
// the deployed function, which runs with the project root as its working directory.
const PARSER_PATH = path.join(process.cwd(), 'lib', 'ai-practice', 'extract-parser.cjs')

let activeParsers = 0
const waitingParsers: Array<() => void> = []
const liveParsers = new Set<ChildProcess>()
let exitHookInstalled = false

/** Running and queued parses in this process, and parser and ps sampler processes still alive; all return to zero. */
export function parserLoad(): { active: number; queued: number; processes: number; samplers: number } {
  return { active: activeParsers, queued: waitingParsers.length, processes: liveParsers.size, samplers: liveSamplers.size }
}

function releaseParser(): void {
  activeParsers -= 1
  waitingParsers.shift()?.()
}

/** A parser slot, or false when the queue is full or the wait runs out. */
function acquireParser(waitMs: number): Promise<boolean> {
  if (activeParsers < MAX_CONCURRENT_PARSERS) { activeParsers += 1; return Promise.resolve(true) }
  if (waitingParsers.length >= MAX_QUEUED_PARSES) return Promise.resolve(false)
  return new Promise(resolve => {
    const grant = () => { clearTimeout(timer); activeParsers += 1; resolve(true) }
    const timer = setTimeout(() => {
      const position = waitingParsers.indexOf(grant)
      if (position !== -1) waitingParsers.splice(position, 1)
      resolve(false)
    }, waitMs)
    waitingParsers.push(grant)
  })
}

const isParserAnswer = (value: unknown): value is ExtractionResult => {
  if (typeof value !== 'object' || value === null || !('status' in value)) return false
  if (value.status === 'unavailable') return true
  if (value.status === 'ok') return 'text' in value && typeof value.text === 'string' && value.text.length <= MAX_RAW_TEXT_CHARS
  return value.status === 'rejected' && 'reason' in value && typeof value.reason === 'string' &&
    ['unsupported-type', 'corrupt', 'encrypted', 'too-much-text'].includes(value.reason)
}

/**
 * Parse one PDF or DOCX in a fresh child process with no environment variables and a V8 heap cap. This
 * process enforces the wall-clock deadline and a resident-memory budget and SIGKILLs the parser at either,
 * which stops CPU-bound parsing outright. The answer waits for the parser's death; a parser that will not die
 * keeps its slot, so capacity never exceeds the pool however termination fails.
 */
export async function parseInIsolation(kind: ParserKind, bytes: Uint8Array, overrides: Partial<ParserLimits> = {}):
  Promise<ParseReport> {
  const limits = { ...PARSER_DEFAULTS, ...overrides }
  const started = Date.now()
  if (!await acquireParser(limits.queueWaitMs)) {
    return { result: { status: 'unavailable' }, outcome: 'unavailable', elapsedMs: Date.now() - started, peakResidentBytes: 0 }
  }
  let held = false
  try {
    const run = runParser(kind, bytes, limits, started)
    const report = await run.report
    if (report.outcome === 'uncontained') { held = true; void run.contained.then(releaseParser) }
    return report
  } finally {
    if (!held) releaseParser()
  }
}

function runParser(kind: ParserKind, bytes: Uint8Array, limits: ParserLimits, started: number):
  { report: Promise<ParseReport>; contained: Promise<void> } {
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.once('exit', () => killAll(liveParsers, liveSamplers))
  }
  const unavailable = (outcome: ParseOutcome): ParseReport =>
    ({ result: { status: 'unavailable' }, outcome, elapsedMs: Date.now() - started, peakResidentBytes: 0 })
  let child: ChildProcess
  try {
    // Not a module import: Turbopack must not resolve this path at build time; outputFileTracingIncludes ships it.
    child = fork(/* turbopackIgnore: true */ PARSER_PATH, [], {
      // No secrets, preload hooks, NODE_OPTIONS or inspector flags reach the parser.
      env: { NODE_ENV: 'production' }, execArgv: [`--max-old-space-size=${limits.maxHeapMb}`],
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
  } catch (error) {
    console.error('AI practice parser could not start', errorMessage(error))
    return { report: Promise.resolve(unavailable('unavailable')), contained: Promise.resolve() }
  }
  // Every listener that keeps a failed signal from crashing the server is in place before any signal.
  const parser = supervise(child, 'parser', liveParsers)
  let markContained = () => {}
  const contained = new Promise<void>(done => { markContained = done })

  const report = new Promise<ParseReport>(resolve => {
    let peakResidentBytes = 0
    let stderr = ''
    let settled = false
    let sample: (MemorySample & { started: number; settled: boolean }) | null = null
    const answer = (outcome: ParseOutcome, result: ExtractionResult) =>
      resolve({ result, outcome, elapsedMs: Date.now() - started, peakResidentBytes })
    const finish = (outcome: ParseOutcome, result: ExtractionResult) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearInterval(sampling)
      // Armed before any signal, so the request is answered in bounded time however termination fails.
      const grace = setTimeout(() => {
        console.error('AI practice parser or its memory sampler survived SIGKILL; the slot stays held until both exit')
        answer('uncontained', { status: 'unavailable' })
      }, PARSER_EXIT_GRACE_MS)
      // A failed signal or a slow reap is retried until each process dies, however long that takes.
      const stopping = [parser.terminate(false)]
      if (sample?.sampler) stopping.push(sample.sampler.terminate(true))
      void Promise.all(stopping).then(() => { clearTimeout(grace); markContained(); answer(outcome, result) })
    }
    const unmonitored = (reason: string) => {
      console.error('AI practice parser memory could not be measured', reason)
      finish('unmonitored', { status: 'unavailable' })
    }
    const deadline = setTimeout(() => finish('timeout', { status: 'rejected', reason: 'corrupt' }), limits.timeoutMs)
    const sampling = setInterval(() => {
      if (settled || parser.isDead() || child.pid === undefined) return
      if (sample !== null) {
        if (!sample.settled && Date.now() - sample.started > MEMORY_SAMPLE_TIMEOUT_MS) unmonitored('a sample did not complete')
        // The next sample waits for this one's ps to be confirmed dead, so samplers never pile up.
        if (!sample.settled || sample.sampler?.isDead() === false) return
      }
      // One sample per parse at a time, and a slot is held until its sampler is dead, so the cap is the pool.
      const current = { ...startSample(child.pid, MAX_CONCURRENT_PARSERS), started: Date.now(), settled: false }
      sample = current
      current.bytes.then(bytesInUse => {
        // Gone: the exit event settles the parse.
        if (bytesInUse === 'gone') return
        peakResidentBytes = Math.max(peakResidentBytes, bytesInUse)
        if (bytesInUse > limits.maxResidentBytes) finish('memory', { status: 'rejected', reason: 'too-much-text' })
      }, (error: unknown) => {
        // After settling, a failed sample is only the in-flight ps being stopped.
        if (!settled && !parser.isDead()) unmonitored(errorMessage(error))
      }).finally(() => { current.settled = true })
    }, MEMORY_SAMPLE_MS)
    // Never spawned: supervise has already logged why, and there is nothing to kill.
    if (parser.isDead()) { finish('unavailable', { status: 'unavailable' }); return }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS) })
    child.once('message', (message: unknown) => {
      if (!isParserAnswer(message)) finish('crashed', { status: 'rejected', reason: 'corrupt' })
      else if (message.status === 'unavailable') finish('unavailable', message)
      else finish('ok', message)
    })
    // Before settling this is a failed run; afterwards a failed kill retry, which the retries already handle.
    child.on('error', () => finish('unavailable', { status: 'unavailable' }))
    child.once('exit', (code, signal) => {
      if (settled) return
      if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(stderr)) {
        console.error('AI practice parser is missing from this deployment')
        finish('unavailable', { status: 'unavailable' })
      } else if (signal === 'SIGABRT' || code === 134 || /heap out of memory|Allocation failed/.test(stderr)) {
        finish('memory', { status: 'rejected', reason: 'too-much-text' })
      } else finish('crashed', { status: 'rejected', reason: 'corrupt' })
    })
    // Transferred by structured clone; the caller keeps its own bytes.
    child.send({ kind, bytes, limits: {
      maxRawTextChars: MAX_RAW_TEXT_CHARS, maxPdfPages: MAX_PDF_PAGES,
      maxDocxXmlBytes: MAX_DOCX_XML_BYTES, maxDocxCompressionRatio: MAX_DOCX_COMPRESSION_RATIO,
    } }, error => { if (error) finish('crashed', { status: 'rejected', reason: 'corrupt' }) })
  })
  return { report, contained }
}
