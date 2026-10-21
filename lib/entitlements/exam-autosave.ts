// lib/entitlements/exam-autosave.ts — Saving the Discovery Pass exam sheet while the exam is open.
// Framework-free so the rules can be tested without a browser. The controller keeps one save in flight at a time,
// numbers every change (the revision the database applies in order, never backwards), saves at once when the deadline
// is near instead of waiting out the debounce, retries a failed save with bounded backoff while the exam is open,
// re-bases when another copy of the sheet got ahead, and reports at every step whether the sheet is saved, saving,
// unsaved or could not be saved. A pending sheet is still sent when the deadline passes; the database closes the exam
// on its own clock and marks the last sheet it accepted in time, never a later one.
import type { SampleAnswers } from './discovery-contract'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed'

export type SaveOutcome =
  /** The database now holds the sheet sent, at `revision`. */
  | { kind: 'saved'; revision: number }
  /** The database already holds a sheet at or above the revision sent (another tab, or an older save that arrived
   *  late). `answers` is the sheet that stands; this device re-bases above `revision` and sends its sheet again. */
  | { kind: 'stale'; revision: number; answers: SampleAnswers }
  /** The save did not reach the database (network, timeout, outage). Worth retrying. */
  | { kind: 'failed' }
  /** The server will not take saves for this exam any more (signed out, pass ended, exam closed). */
  | { kind: 'refused'; status: string }

export type AutosaveSnapshot = {
  state: SaveState
  /** The latest change the student made. */
  revision: number
  /** The highest revision the database has confirmed. */
  savedRevision: number
  /** Consecutive sends that failed since the last confirmation. */
  attempts: number
  refusal: string | null
}

export type AutosaveOptions = {
  /** The sheet the exam opens with: the database's, or a newer one restored on this device. */
  answers: SampleAnswers
  revision: number
  /** The revision the database holds. When the restored sheet is newer, it is saved right away. */
  savedRevision: number
  /** Milliseconds until the server deadline, on the caller's clock. */
  remaining(): number
  send(answers: SampleAnswers, revision: number): Promise<SaveOutcome>
  schedule(run: () => void, ms: number): unknown
  cancel(handle: unknown): void
  onChange(snapshot: AutosaveSnapshot): void
  /** Another copy of the sheet was found newer on the server and merged into this one (answers this device never
   *  touched are taken from it; this device's own choices win). */
  onRebase?(answers: SampleAnswers): void
}

export const AUTOSAVE = {
  /** A change is sent this long after the last one, so a run of quick changes is one save. */
  delayMs: 800,
  /** Inside this window before the deadline every change is sent at once. */
  nearDeadlineMs: 15_000,
  /** Retry backoff after a failed save: base × 2^(attempt − 1), capped. */
  retryBaseMs: 2_000,
  retryMaxMs: 15_000,
  /** Retries after which the student is asked to save by hand; a new change starts the count again. */
  maxRetries: 8,
} as const

export function retryDelayMs(attempt: number): number {
  return Math.min(AUTOSAVE.retryMaxMs, AUTOSAVE.retryBaseMs * 2 ** Math.max(0, attempt - 1))
}

export class ExamAutosave {
  private answers: SampleAnswers
  private revision: number
  private savedRevision: number
  private attempts = 0
  private refusal: string | null = null
  private inFlight: Promise<void> | null = null
  private stopped = false
  private timer: unknown = null

  constructor(private readonly options: AutosaveOptions) {
    this.answers = options.answers
    this.revision = Math.max(options.revision, options.savedRevision)
    this.savedRevision = options.savedRevision
    if (this.revision > this.savedRevision) this.plan()
    else this.notify()
  }

  snapshot(): AutosaveSnapshot {
    const state: SaveState = this.refusal !== null ? 'failed'
      : this.inFlight !== null ? 'saving'
        : this.revision <= this.savedRevision ? 'saved'
          : this.options.remaining() <= 0 ? 'closed'
            : this.attempts > AUTOSAVE.maxRetries ? 'failed'
              : 'unsaved'
    return { state, revision: this.revision, savedRevision: this.savedRevision, attempts: this.attempts,
      refusal: this.refusal }
  }

  /** The student changed an answer. Returns the new revision, or null when the sheet can no longer change. */
  change(answers: SampleAnswers): number | null {
    if (this.stopped || this.refusal !== null || this.options.remaining() <= 0) return null
    this.answers = answers
    this.revision += 1
    this.attempts = 0
    this.plan()
    return this.revision
  }

  /**
   * Send any unsaved sheet now (the deadline, a submission, or the page being left). Resolves once the save in flight
   * has settled, so a submission can let the sheet reach the server first; the server still decides what was in time.
   */
  flush(): Promise<void> {
    this.clearTimer()
    if (this.inFlight === null && this.revision > this.savedRevision) return this.send()
    this.notify()
    return this.inFlight ?? Promise.resolve()
  }

  /** The student asked to save after the automatic retries gave up. */
  retry(): void {
    this.attempts = 0
    this.flush()
  }

  /** No further saves: the exam is being submitted or the screen is going away. */
  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private plan(): void {
    this.clearTimer()
    if (this.inFlight !== null) { this.notify(); return }
    const delay = this.options.remaining() <= AUTOSAVE.nearDeadlineMs ? 0 : AUTOSAVE.delayMs
    this.timer = this.options.schedule(() => { this.timer = null; void this.send() }, delay)
    this.notify()
  }

  /**
   * Send the latest sheet. A pending sheet is always sent, even once this device's clock has passed the deadline: the
   * server's clock is the only cutoff, and it answers with the marked result when the exam has closed. Only new
   * retries are not planned after the deadline.
   */
  private send(): Promise<void> {
    if (this.stopped || this.inFlight !== null || this.refusal !== null || this.revision <= this.savedRevision) {
      return this.inFlight ?? Promise.resolve()
    }
    const revision = this.revision
    const request = this.deliver(revision)
    this.inFlight = request
    this.notify()
    return request
  }

  private async deliver(revision: number): Promise<void> {
    let outcome: SaveOutcome
    try { outcome = await this.options.send(this.answers, revision) }
    catch { outcome = { kind: 'failed' } }
    this.inFlight = null
    if (this.stopped) return
    if (outcome.kind === 'saved' && outcome.revision === revision) {
      // The confirmation never goes backwards, whatever order responses arrive in.
      this.savedRevision = Math.max(this.savedRevision, revision)
      this.attempts = 0
      // A change made while this save was in flight goes next, at once, whatever the clock says.
      if (this.revision > this.savedRevision) { void this.send(); return }
      this.notify()
      return
    }
    if (outcome.kind === 'refused') {
      this.refusal = outcome.status
      this.notify()
      return
    }
    if (outcome.kind === 'stale' && outcome.revision >= revision) {
      // Another copy of the sheet got ahead (another tab, or an earlier save that arrived after a retry). Keep the
      // other copy's answers for questions this device never answered, keep this device's own choices, and send the
      // merged sheet above the server's revision. Bounded like a failure, so two copies can never chase each other
      // without end.
      this.savedRevision = Math.max(this.savedRevision, outcome.revision)
      this.answers = { ...outcome.answers, ...this.answers }
      this.revision = this.savedRevision + 1
      this.options.onRebase?.(this.answers)
      this.attempts += 1
      if (this.attempts <= AUTOSAVE.maxRetries) { void this.send(); return }
      this.notify()
      return
    }
    // A failure, or an acknowledgement that does not name the sheet just sent: retry with backoff, never spin.
    this.attempts += 1
    if (this.attempts <= AUTOSAVE.maxRetries && this.options.remaining() > 0) {
      this.clearTimer()
      this.timer = this.options.schedule(() => { this.timer = null; void this.send() }, retryDelayMs(this.attempts))
    }
    this.notify()
  }

  private clearTimer(): void {
    if (this.timer !== null) { this.options.cancel(this.timer); this.timer = null }
  }

  private notify(): void {
    this.options.onChange(this.snapshot())
  }
}
