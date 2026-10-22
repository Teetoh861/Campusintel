// lib/entitlements/exam-autosave.ts — Saving the Discovery Pass exam sheet while the exam is open.
// Framework-free so the rules can be tested without a browser. The controller numbers every change (the revision the
// database applies in order, never backwards), coalesces a run of quick changes into one save, saves at once when the
// deadline is near, retries a failed save with bounded backoff while the exam is open, and reports at every step
// whether the sheet is saved, saving, unsaved or could not be saved.
// Two rules protect the sheet against other copies of it and against slow requests:
//   * It remembers the last sheet the server acknowledged (the base) and which questions this device changed since
//     (dirty, each at the revision that changed it). When the server answers that another copy got ahead, only the
//     dirty questions are laid over the server's sheet; a question this device never touched takes the other copy's
//     answer. A question both copies changed keeps this device's choice, the one the student made most recently here,
//     and is sent again so the server holds it explicitly.
//   * One request is normally in flight, but a newer sheet does not wait behind a slow one for ever: it overtakes once
//     the deadline is near, once the older request has been pending for a while, or on a flush. The database accepts
//     revisions in order only, so an older request that arrives later is answered stale and changes nothing.
// A pending sheet is still sent when the deadline passes; the database closes the exam on its own clock and marks the
// last sheet it accepted in time, never a later one. "Saved" always means the server confirmed this device's latest
// revision.
import type { SampleAnswers } from './discovery-contract'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed'

export type SaveOutcome =
  /** The database now holds the sheet sent, at `revision`. */
  | { kind: 'saved'; revision: number }
  /** The database already holds a sheet at or above the revision sent (another tab, or an older save that arrived
   *  late). `answers` is the sheet that stands; this device re-bases its own changes above `revision`. */
  | { kind: 'stale'; revision: number; answers: SampleAnswers }
  /** The save did not reach the database (network, timeout, outage). Worth retrying. */
  | { kind: 'failed' }
  /** The server will not take saves for this exam any more (signed out, pass ended, exam closed). */
  | { kind: 'refused'; status: string }

export type AutosaveSnapshot = {
  state: SaveState
  /** The latest change the student made. */
  revision: number
  /** The highest revision the database has confirmed for this device's sheet. */
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
  /** The sheet the database holds at `savedRevision`; defaults to `answers`. Differences are this device's changes. */
  saved?: SampleAnswers
  /** Milliseconds until the server deadline, on the caller's clock. */
  remaining(): number
  send(answers: SampleAnswers, revision: number): Promise<SaveOutcome>
  schedule(run: () => void, ms: number): unknown
  cancel(handle: unknown): void
  onChange(snapshot: AutosaveSnapshot): void
  /** Another copy of the sheet was found newer on the server and this device's changes were laid over it. */
  onRebase?(answers: SampleAnswers): void
}

export const AUTOSAVE = {
  /** A change is sent this long after the last one, so a run of quick changes is one save. */
  delayMs: 800,
  /** Inside this window before the deadline every change is sent at once, overtaking any save still in flight. */
  nearDeadlineMs: 15_000,
  /** Outside that window a newer sheet overtakes a save that has been in flight this long. */
  overtakeAfterMs: 5_000,
  /** Retry backoff after a failed save: base × 2^(attempt − 1), capped. */
  retryBaseMs: 2_000,
  retryMaxMs: 15_000,
  /** Retries after which the student is asked to save by hand; a new change starts the count again. */
  maxRetries: 8,
} as const

export function retryDelayMs(attempt: number): number {
  return Math.min(AUTOSAVE.retryMaxMs, AUTOSAVE.retryBaseMs * 2 ** Math.max(0, attempt - 1))
}

/** The server's sheet with this device's own changes laid over it. Only dirty questions come from this device. */
export function mergeSheets(server: SampleAnswers, local: SampleAnswers, dirty: Iterable<string>): SampleAnswers {
  const merged: SampleAnswers = { ...server }
  for (const item of dirty) {
    const choice = local[item]
    if (choice === undefined) delete merged[item]
    else merged[item] = choice
  }
  return merged
}

type InFlight = { sentAt: number; settled: Promise<void> }

export class ExamAutosave {
  private answers: SampleAnswers
  private revision: number
  private savedRevision: number
  /** The last sheet the server acknowledged as standing. */
  private base: SampleAnswers
  /** Questions changed on this device since `base`, each at the revision that changed it. */
  private readonly dirty = new Map<string, number>()
  private attempts = 0
  private refusal: string | null = null
  private readonly inFlight = new Map<number, InFlight>()
  private stopped = false
  private timer: unknown = null

  constructor(private readonly options: AutosaveOptions) {
    this.answers = options.answers
    this.base = options.saved ?? options.answers
    this.revision = Math.max(options.revision, options.savedRevision)
    this.savedRevision = options.savedRevision
    if (this.revision > this.savedRevision) {
      for (const item of differences(this.base, this.answers)) this.dirty.set(item, this.revision)
      this.plan()
    } else this.notify()
  }

  snapshot(): AutosaveSnapshot {
    const state: SaveState = this.refusal !== null ? 'failed'
      : this.inFlight.size > 0 ? 'saving'
        : this.revision <= this.savedRevision ? 'saved'
          : this.options.remaining() <= 0 ? 'closed'
            : this.attempts > AUTOSAVE.maxRetries ? 'failed'
              : 'unsaved'
    return { state, revision: this.revision, savedRevision: this.savedRevision, attempts: this.attempts,
      refusal: this.refusal }
  }

  /**
   * The student changed an answer. Returns the new revision, or null when the sheet can no longer change (the deadline
   * has passed on this device's clock, the server refused further saves, or the exam is being submitted). A null means
   * the choice was not accepted and must not be shown as made.
   */
  change(answers: SampleAnswers): number | null {
    if (this.stopped || this.refusal !== null || this.options.remaining() <= 0) return null
    this.revision += 1
    for (const item of differences(this.answers, answers)) this.dirty.set(item, this.revision)
    this.answers = answers
    this.attempts = 0
    this.plan()
    return this.revision
  }

  /**
   * Send any unsaved sheet now (the deadline, a submission, or the page being left), overtaking a save still in
   * flight. Resolves once every request in flight has settled, so a submission can let the sheet reach the server
   * first; the server still decides what was in time.
   */
  flush(): Promise<void> {
    this.clearTimer()
    this.send()
    this.notify()
    return Promise.all([...this.inFlight.values()].map(request => request.settled)).then(() => undefined)
  }

  /** The student asked to save after the automatic retries gave up. */
  retry(): void {
    this.attempts = 0
    void this.flush()
  }

  /** No further saves: the exam is being submitted or the screen is going away. */
  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private near(): boolean {
    return this.options.remaining() <= AUTOSAVE.nearDeadlineMs
  }

  /** How long the oldest save in flight has been pending, on the caller's clock. */
  private oldestInFlightMs(): number {
    const now = this.options.remaining()
    return Math.max(0, ...[...this.inFlight.values()].map(request => request.sentAt - now))
  }

  private plan(): void {
    this.clearTimer()
    this.timer = this.options.schedule(() => { this.timer = null; this.dispatch() }, this.near() ? 0 : AUTOSAVE.delayMs)
    this.notify()
  }

  /**
   * Send the latest sheet, or wait a little longer for the save in flight. A newer sheet never waits behind an older
   * request once the deadline is near or that request has been pending for overtakeAfterMs: the server applies
   * revisions in order, so a parallel older request cannot overwrite it.
   */
  private dispatch(): void {
    if (!this.pending()) return
    if (this.inFlight.size === 0 || this.near()) { this.send(); return }
    const waited = this.oldestInFlightMs()
    if (waited >= AUTOSAVE.overtakeAfterMs) { this.send(); return }
    const untilOvertake = AUTOSAVE.overtakeAfterMs - waited
    const untilNear = Math.max(0, this.options.remaining() - AUTOSAVE.nearDeadlineMs)
    this.clearTimer()
    this.timer = this.options.schedule(() => { this.timer = null; this.dispatch() },
      Math.max(1, Math.min(untilOvertake, untilNear)))
  }

  /** Whether the latest sheet still has to be sent. */
  private pending(): boolean {
    return !this.stopped && this.refusal === null && this.revision > this.savedRevision && !this.inFlight.has(this.revision)
  }

  /**
   * Send the latest sheet now unless it is already on its way. A pending sheet is sent even once this device's clock
   * has passed the deadline: the server's clock is the only cutoff, and it answers with the marked result when the exam
   * has closed. Only new retries are not planned after the deadline.
   */
  private send(): void {
    if (!this.pending()) return
    const revision = this.revision
    const request: InFlight = { sentAt: this.options.remaining(), settled: Promise.resolve() }
    this.inFlight.set(revision, request)
    request.settled = this.deliver(revision, this.answers)
    this.notify()
  }

  private async deliver(revision: number, answers: SampleAnswers): Promise<void> {
    let outcome: SaveOutcome
    try { outcome = await this.options.send(answers, revision) }
    catch { outcome = { kind: 'failed' } }
    this.inFlight.delete(revision)
    if (this.stopped) return
    if (outcome.kind === 'saved' && outcome.revision === revision) {
      // The confirmation never goes backwards, whatever order responses arrive in. Everything changed up to this
      // revision is now the server's sheet too.
      if (revision > this.savedRevision) { this.savedRevision = revision; this.base = answers }
      for (const [item, changedAt] of this.dirty) if (changedAt <= revision) this.dirty.delete(item)
      this.attempts = 0
      // A change made while this save was in flight goes next, at once, whatever the clock says.
      this.send()
      this.notify()
      return
    }
    if (outcome.kind === 'refused') {
      this.refusal = outcome.status
      this.notify()
      return
    }
    if (outcome.kind === 'stale' && outcome.revision >= revision) {
      if (outcome.revision <= this.savedRevision) {
        // An older request of this device answered after a newer one had already landed: nothing new to learn.
        this.send()
        this.notify()
        return
      }
      // Another copy of the sheet got ahead (another tab, or an earlier save that arrived after a retry). Take its
      // sheet as the base, lay this device's own changes over it, and send the merged sheet above the server's
      // revision. Bounded like a failure, so two copies can never chase each other without end.
      this.savedRevision = outcome.revision
      this.base = outcome.answers
      this.answers = mergeSheets(this.base, this.answers, this.dirty.keys())
      if (this.dirty.size === 0) {
        // Nothing of this device's is missing from the server's sheet: it stands as saved.
        this.revision = this.savedRevision
        this.options.onRebase?.(this.answers)
        this.notify()
        return
      }
      this.revision = Math.max(this.revision, this.savedRevision) + 1
      for (const item of this.dirty.keys()) this.dirty.set(item, this.revision)
      this.options.onRebase?.(this.answers)
      this.attempts += 1
      if (this.attempts <= AUTOSAVE.maxRetries) this.send()
      this.notify()
      return
    }
    // A failure, or an acknowledgement that does not name the sheet just sent: retry with backoff, never spin.
    this.attempts += 1
    if (this.attempts <= AUTOSAVE.maxRetries && this.options.remaining() > 0 && this.inFlight.size === 0) {
      this.clearTimer()
      this.timer = this.options.schedule(() => { this.timer = null; this.dispatch() }, retryDelayMs(this.attempts))
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

function differences(before: SampleAnswers, after: SampleAnswers): string[] {
  const items = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...items].filter(item => before[item] !== after[item])
}
