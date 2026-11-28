// lib/entitlements/exam-clock.ts — How much exam time is left on this device, conservatively.
// Framework-free so the rules can be tested without a browser. The database deadline is the only authority on what
// counts; this clock decides only whether a tap on this device may still change an answer. It never trusts the
// device's wall clock: a fresh exchange with the server gives the server's clock and the deadline, and the elapsed
// time since is measured on the monotonic clock. The exchange's round trip is charged in full, as if the server had
// read its clock the moment the request left, so the cutoff here is never later than the real deadline. Until an
// exchange has succeeded there is no trustworthy reading and answers cannot change; the same happens again whenever
// the device may have slept (the page hidden, or the wall clock drifting from the monotonic one), until a fresh
// exchange lands. Every invalidation starts a new generation: an exchange that began before it is discarded when it
// answers, whatever it says, so only an exchange started after the latest invalidation can enable answering again.
// The server's reading is also refreshed after a failed exchange, with bounded backoff.
// The same exchange also bounds the deadline from the other side: it cannot be later than if the server had read its
// clock as its answer arrived. An exam is handed in at time up only once that has passed (untilPassed), so the server
// closes it as timed out; handed in at the early cutoff, it could still be open there and be taken as submitted.
// A reading the page already holds can seed the clock (seed): the server's clock and deadline that came with the exam,
// with when that request left and when its answer had arrived on the monotonic clock. It is taken exactly like an
// exchange (the whole round trip charged as elapsed), so answers can change from the first render, and the first
// exchange still goes out at start and replaces it.
export type ClockReading = {
  /** The server's clock when it answered, in epoch milliseconds. */
  serverNow: number
  /** The exam deadline on the server's clock, in epoch milliseconds. */
  deadline: number
}

/** A reading taken outside the clock, with the request's departure and the answer's arrival on the monotonic clock. */
export type ClockSeed = { reading: ClockReading; sentAt: number; receivedAt: number }

export type ClockState = 'unsynced' | 'synced'

export type ExamClockOptions = {
  /** The monotonic clock, in milliseconds (performance.now). */
  monotonic(): number
  /** The wall clock, in epoch milliseconds (Date.now). Used only to notice that the device may have slept. */
  wall(): number
  /** A fresh server exchange; resolves null when it failed or was refused. */
  sync(): Promise<ClockReading | null>
  schedule(run: () => void, ms: number): unknown
  cancel(handle: unknown): void
  /** The state or the reading changed. */
  onChange(state: ClockState): void
  /** The reading the page came with, used until the first exchange lands. */
  seed?: ClockSeed | null
}

export const EXAM_CLOCK = {
  /** A round trip longer than this says nothing useful about the time left: the reading is discarded and retried. */
  maxRoundTripMs: 10_000,
  /** The wall clock and the monotonic clock drifting apart by this much since the exchange means the device slept
   *  (or its clock was set); the reading is no longer trusted until a fresh exchange lands. */
  maxDriftMs: 2_000,
  /** Backoff between failed exchanges: base × 2^(attempt − 1), capped. */
  retryBaseMs: 1_000,
  retryMaxMs: 10_000,
  /** Added before the deadline is taken to have passed on the server: between exchanges the two clocks can run at
   *  slightly different speeds, and the server's readings arrive in whole milliseconds. */
  passedMarginMs: 500,
} as const

export function syncRetryMs(attempt: number): number {
  return Math.min(EXAM_CLOCK.retryMaxMs, EXAM_CLOCK.retryBaseMs * 2 ** Math.max(0, attempt - 1))
}

/** The parts of this document's navigation timing a seed needs (PerformanceNavigationTiming), in monotonic ms. */
export type DocumentTiming = { requestStart: number; responseEnd: number }

/**
 * A seed from the server reading this document was rendered with. The server read its clock after the document's
 * request left (requestStart) and before the answer carrying it had arrived: by responseEnd, or by `now` while the
 * response is still streaming. Null without usable timing; the clock then waits for its first exchange.
 */
export function documentClockSeed(reading: ClockReading, timing: DocumentTiming | null, now: number): ClockSeed | null {
  if (timing === null || !Number.isFinite(timing.requestStart) || timing.requestStart < 0) return null
  const receivedAt = timing.responseEnd > timing.requestStart ? timing.responseEnd : now
  return receivedAt < timing.requestStart ? null : { reading, sentAt: timing.requestStart, receivedAt }
}

/**
 * This document's navigation timing, read in the browser; null when it is missing, or when the wall and monotonic
 * clocks have drifted apart since the navigation began (the device may have slept), so nothing stale seeds the clock.
 */
export function browserDocumentTiming(): DocumentTiming | null {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (entry === undefined || !Number.isFinite(performance.timeOrigin)) return null
    if (Math.abs(Date.now() - performance.now() - performance.timeOrigin) > EXAM_CLOCK.maxDriftMs) return null
    return { requestStart: entry.requestStart, responseEnd: entry.responseEnd }
  } catch { return null }
}

export class ExamClock {
  /** The deadline on the monotonic clock, from the last trusted exchange; null without one. */
  private deadlineAt: number | null = null
  /** The round trip of that exchange: how much earlier than the server's deadline `deadlineAt` can be. */
  private roundTrip = 0
  /** wall − monotonic at the last trusted exchange, to notice the device sleeping. */
  private drift = 0
  private attempts = 0
  private syncing = false
  private wanted = false
  /** Advanced by every invalidation; an exchange publishes only if it started in the current generation. */
  private generation = 0
  private stopped = false
  private timer: unknown = null

  constructor(private readonly options: ExamClockOptions) {
    const seed = options.seed ?? null
    if (seed !== null) this.accept(seed.reading, seed.sentAt, seed.receivedAt)
  }

  state(): ClockState {
    return this.deadlineAt === null ? 'unsynced' : 'synced'
  }

  /**
   * Milliseconds left on the conservative reading, or null while there is none. Read at the moment of every tap, not
   * from a countdown shown a moment ago. A drift between the clocks since the exchange invalidates the reading at
   * once and asks for a fresh one.
   */
  remaining(): number | null {
    if (this.deadlineAt === null) return null
    if (Math.abs(this.options.wall() - this.options.monotonic() - this.drift) > EXAM_CLOCK.maxDriftMs) {
      this.invalidate()
      return null
    }
    return this.deadlineAt - this.options.monotonic()
  }

  /**
   * Milliseconds until the deadline has certainly passed on the server, or null while there is no reading (zero or
   * less once it has). The cutoff in remaining() can come before the server's deadline by the exchange's round trip:
   * this gives that round trip back, as if the server had read its clock when its answer arrived, and adds a margin.
   */
  untilPassed(): number | null {
    const remaining = this.remaining()
    return remaining === null ? null : remaining + this.roundTrip + EXAM_CLOCK.passedMarginMs
  }

  /** Start the first exchange. */
  start(): void {
    this.resync()
  }

  /**
   * The reading can no longer be trusted (the page was hidden, the device may have slept): read the server again.
   * Any exchange already in flight belongs to the old generation and will be discarded when it answers.
   */
  invalidate(): void {
    this.generation += 1
    if (this.deadlineAt !== null) {
      this.deadlineAt = null
      this.options.onChange('unsynced')
    }
    this.resync()
  }

  /** Ask the server again now (or as soon as the exchange in flight settles). */
  resync(): void {
    if (this.stopped) return
    this.clearTimer()
    if (this.syncing) { this.wanted = true; return }
    void this.exchange()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private async exchange(): Promise<void> {
    this.syncing = true
    const generation = this.generation
    const sentAt = this.options.monotonic()
    let reading: ClockReading | null
    try { reading = await this.options.sync() } catch { reading = null }
    const receivedAt = this.options.monotonic()
    this.syncing = false
    if (this.stopped) return
    if (generation !== this.generation) {
      // Started before the latest invalidation: its reading says nothing about now. Nothing is published, and the
      // exchange the invalidation asked for goes next.
      this.wanted = false
      void this.exchange()
      return
    }
    if (reading !== null && this.accept(reading, sentAt, receivedAt)) {
      this.attempts = 0
      this.options.onChange('synced')
      if (this.wanted) { this.wanted = false; this.resync() }
      return
    }
    this.attempts += 1
    this.options.onChange(this.state())
    if (this.wanted) { this.wanted = false; this.resync(); return }
    this.clearTimer()
    this.timer = this.options.schedule(() => { this.timer = null; void this.exchange() }, syncRetryMs(this.attempts))
  }

  /** Take a reading whose round trip says something useful about the time left; false when it does not. */
  private accept(reading: ClockReading, sentAt: number, receivedAt: number): boolean {
    const roundTrip = receivedAt - sentAt
    if (!(roundTrip >= 0 && roundTrip <= EXAM_CLOCK.maxRoundTripMs) || !Number.isFinite(reading.deadline - reading.serverNow)) {
      return false
    }
    // As if the server read its clock when the request left: the whole round trip counts as elapsed.
    this.deadlineAt = sentAt + (reading.deadline - reading.serverNow)
    this.roundTrip = roundTrip
    this.drift = this.options.wall() - this.options.monotonic()
    return true
  }

  private clearTimer(): void {
    if (this.timer !== null) { this.options.cancel(this.timer); this.timer = null }
  }
}
