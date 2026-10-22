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
export type ClockReading = {
  /** The server's clock when it answered, in epoch milliseconds. */
  serverNow: number
  /** The exam deadline on the server's clock, in epoch milliseconds. */
  deadline: number
}

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
} as const

export function syncRetryMs(attempt: number): number {
  return Math.min(EXAM_CLOCK.retryMaxMs, EXAM_CLOCK.retryBaseMs * 2 ** Math.max(0, attempt - 1))
}

export class ExamClock {
  /** The deadline on the monotonic clock, from the last trusted exchange; null without one. */
  private deadlineAt: number | null = null
  /** wall − monotonic at the last trusted exchange, to notice the device sleeping. */
  private drift = 0
  private attempts = 0
  private syncing = false
  private wanted = false
  /** Advanced by every invalidation; an exchange publishes only if it started in the current generation. */
  private generation = 0
  private stopped = false
  private timer: unknown = null

  constructor(private readonly options: ExamClockOptions) {}

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
    const roundTrip = receivedAt - sentAt
    if (reading !== null && roundTrip >= 0 && roundTrip <= EXAM_CLOCK.maxRoundTripMs) {
      // As if the server read its clock when the request left: the whole round trip counts as elapsed.
      this.deadlineAt = sentAt + (reading.deadline - reading.serverNow)
      this.drift = this.options.wall() - this.options.monotonic()
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

  private clearTimer(): void {
    if (this.timer !== null) { this.options.cancel(this.timer); this.timer = null }
  }
}
