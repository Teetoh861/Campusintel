// lib/entitlements/exam-autosave.ts — Saving the Discovery Pass exam sheet while the exam is open.
// Framework-free so the rules can be tested without a browser. The controller keeps the last sheet the database
// acknowledged (the base, at the database's revision) and the questions this tab changed since (dirty, each at this
// tab's own change sequence). A save sends only those changed questions, with the base revision and the sequence; the
// database lays them over the sheet it holds, under its lock, and answers with the whole sheet that now stands. So a
// question this tab never touched always keeps whatever another tab saved, and two tabs can never overwrite each
// other's answers. A question changed on two tabs takes the change that reaches the database last; every tab then
// shows the sheet the database returned. The database applies one tab's requests in sequence order only, so a request
// delayed on the network behind a newer one changes nothing ("stale"), and a retry is acknowledged, not reapplied.
// Timing: a run of quick changes is one save, a change near the deadline is sent at once, a newer sheet overtakes a
// slow request, a failed save is retried with bounded backoff while the exam is open, and the status reports at every
// step whether the sheet is saved, saving, unsaved or could not be saved. "Saved" always means the database confirmed
// this tab's latest change. A change is accepted only while the clock given here says the exam is open with enough
// confidence; a null means the choice was refused and must not be shown as made.
import type { SampleAnswers, SheetChanges, SheetDelta } from './discovery-contract'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed' | 'closed'

export type SheetAnswer = { revision: number; answers: SampleAnswers }

export type SaveOutcome =
  /** Everything this tab sent up to the request's sequence is in the database's sheet, which is `answers`. */
  | { kind: 'saved'; revision: number; answers: SampleAnswers }
  /** The request was older than one already applied from this tab: nothing changed; `answers` stands. */
  | { kind: 'stale'; revision: number; answers: SampleAnswers }
  /** The save did not reach the database (network, timeout, outage). Worth retrying. */
  | { kind: 'failed' }
  /** The server will not take saves for this exam any more (signed out, pass ended, exam closed). */
  | { kind: 'refused'; status: string }

export type AutosaveSnapshot = {
  state: SaveState
  /** This tab's latest change sequence. */
  revision: number
  /** The highest change sequence the database has confirmed for this tab. */
  savedRevision: number
  /** Consecutive sends that failed since the last confirmation. */
  attempts: number
  refusal: string | null
}

/** What this tab keeps for a reload: its sheet and which questions it changed but has not had confirmed. */
export type UnsentSheet = { answers: SampleAnswers; dirty: string[] }

export type AutosaveOptions = {
  /** This tab's identity for the database's sequence ledger; fresh for every mount, never shared between tabs. */
  tab: string
  /** The sheet the database holds, at its revision. */
  server: SheetAnswer
  /** A sheet this tab kept before a reload, with the questions it had changed: only those are laid over the server's. */
  restored?: UnsentSheet | null
  /** Milliseconds until the deadline on a trustworthy clock, or null while no trustworthy reading exists. */
  remaining(): number | null
  send(delta: SheetDelta): Promise<SaveOutcome>
  schedule(run: () => void, ms: number): unknown
  cancel(handle: unknown): void
  onChange(snapshot: AutosaveSnapshot): void
  /** The sheet on screen must change: the database holds answers from another tab this one never touched. */
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

/** The server's sheet with this tab's own changes laid over it. Only dirty questions come from this tab. */
export function mergeSheets(server: SampleAnswers, local: SampleAnswers, dirty: Iterable<string>): SampleAnswers {
  const merged: SampleAnswers = { ...server }
  for (const item of dirty) {
    const choice = local[item]
    if (choice === undefined) delete merged[item]
    else merged[item] = choice
  }
  return merged
}

function sameSheet(a: SampleAnswers, b: SampleAnswers): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(item => a[item] === b[item])
}

type InFlight = { sentAt: number; settled: Promise<void> }

export class ExamAutosave {
  private answers: SampleAnswers
  /** This tab's count of changes. */
  private sequence = 0
  /** The highest sequence the database has confirmed. */
  private acked = 0
  /** The last sheet the database acknowledged, at its revision. */
  private base: SheetAnswer
  /** Questions changed on this tab since `base`, each at the sequence that changed it. */
  private readonly dirty = new Map<string, number>()
  private attempts = 0
  private refusal: string | null = null
  private readonly inFlight = new Map<number, InFlight>()
  private stopped = false
  private timer: unknown = null

  constructor(private readonly options: AutosaveOptions) {
    this.base = options.server
    this.answers = options.server.answers
    const restored = options.restored ?? null
    if (restored !== null) {
      const merged = mergeSheets(this.base.answers, restored.answers, restored.dirty)
      for (const item of differences(this.base.answers, merged)) this.dirty.set(item, 1)
      this.answers = merged
    }
    if (this.dirty.size > 0) { this.sequence = 1; this.plan() } else this.notify()
  }

  snapshot(): AutosaveSnapshot {
    const remaining = this.options.remaining()
    const state: SaveState = this.refusal !== null ? 'failed'
      : this.inFlight.size > 0 ? 'saving'
        : this.sequence <= this.acked ? 'saved'
          : remaining !== null && remaining <= 0 ? 'closed'
            : this.attempts > AUTOSAVE.maxRetries ? 'failed'
              : 'unsaved'
    return { state, revision: this.sequence, savedRevision: this.acked, attempts: this.attempts, refusal: this.refusal }
  }

  /** The sheet this tab shows, and the questions it changed but has not had confirmed. */
  unsent(): UnsentSheet {
    return { answers: this.answers, dirty: [...this.dirty.keys()] }
  }

  /** What a save or submission carries: this tab's pending changes over the revision it last received. */
  delta(): SheetDelta {
    const changes: SheetChanges = {}
    for (const item of this.dirty.keys()) changes[item] = this.answers[item] ?? null
    return { tab: this.options.tab, sequence: this.sequence, baseRevision: this.base.revision, changes }
  }

  /**
   * The student changed an answer. Returns the new sequence, or null when the sheet can no longer change: the clock
   * has no trustworthy reading or says the exam is over, the server refused further saves, or the exam is being
   * submitted. A null means the choice was not accepted and must not be shown as made.
   */
  change(answers: SampleAnswers): number | null {
    const remaining = this.options.remaining()
    if (this.stopped || this.refusal !== null || remaining === null || remaining <= 0) return null
    this.sequence += 1
    for (const item of differences(this.answers, answers)) this.dirty.set(item, this.sequence)
    this.answers = answers
    this.attempts = 0
    this.plan()
    return this.sequence
  }

  /**
   * The database's sheet, learnt outside a save (a clock sync): this tab's unconfirmed changes are laid over it, and
   * the screen is told when a question it never touched has another tab's answer.
   */
  adopt(sheet: SheetAnswer): void {
    if (this.stopped) return
    this.rebase(sheet)
    this.notify()
  }

  /**
   * Send any unsaved changes now (the deadline, a submission, or the page being left), overtaking a save still in
   * flight. Resolves once every request in flight has settled, so a submission can let the changes reach the server
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
    const remaining = this.options.remaining()
    return remaining !== null && remaining <= AUTOSAVE.nearDeadlineMs
  }

  /** The clock's reading for request timing; without a trustworthy reading the deadline is treated as far away. */
  private clock(): number {
    return this.options.remaining() ?? Number.MAX_SAFE_INTEGER
  }

  /** How long the oldest save in flight has been pending, on the caller's clock. */
  private oldestInFlightMs(): number {
    const now = this.clock()
    return Math.max(0, ...[...this.inFlight.values()].map(request => request.sentAt - now))
  }

  private plan(): void {
    this.clearTimer()
    this.timer = this.options.schedule(() => { this.timer = null; this.dispatch() }, this.near() ? 0 : AUTOSAVE.delayMs)
    this.notify()
  }

  /**
   * Send the latest changes, or wait a little longer for the save in flight. Newer changes never wait behind an older
   * request once the deadline is near or that request has been pending for overtakeAfterMs: the server applies one
   * tab's requests in sequence order, so a parallel older request cannot overwrite them.
   */
  private dispatch(): void {
    if (!this.pending()) return
    if (this.inFlight.size === 0 || this.near()) { this.send(); return }
    const waited = this.oldestInFlightMs()
    if (waited >= AUTOSAVE.overtakeAfterMs) { this.send(); return }
    const untilOvertake = AUTOSAVE.overtakeAfterMs - waited
    const untilNear = Math.max(0, this.clock() - AUTOSAVE.nearDeadlineMs)
    this.clearTimer()
    this.timer = this.options.schedule(() => { this.timer = null; this.dispatch() },
      Math.max(1, Math.min(untilOvertake, untilNear)))
  }

  /** Whether the latest changes still have to be sent. */
  private pending(): boolean {
    return !this.stopped && this.refusal === null && this.sequence > this.acked && !this.inFlight.has(this.sequence)
  }

  /**
   * Send the latest changes now unless they are already on their way. Pending changes are sent even once the clock
   * here has passed the deadline: the server's clock is the only cutoff, and it answers with the marked result when
   * the exam has closed. Only new retries are not planned after the deadline.
   */
  private send(): void {
    if (!this.pending()) return
    const sequence = this.sequence
    const request: InFlight = { sentAt: this.clock(), settled: Promise.resolve() }
    this.inFlight.set(sequence, request)
    request.settled = this.deliver(sequence, this.delta())
    this.notify()
  }

  /** Take the database's sheet as the base and lay this tab's unconfirmed changes over it. */
  private rebase(sheet: SheetAnswer): void {
    if (sheet.revision < this.base.revision) return
    this.base = sheet
    const merged = mergeSheets(sheet.answers, this.answers, this.dirty.keys())
    if (!sameSheet(merged, this.answers)) {
      this.answers = merged
      this.options.onRebase?.(merged)
    }
  }

  private async deliver(sequence: number, delta: SheetDelta): Promise<void> {
    let outcome: SaveOutcome
    try { outcome = await this.options.send(delta) }
    catch { outcome = { kind: 'failed' } }
    this.inFlight.delete(sequence)
    if (this.stopped) return
    if (outcome.kind === 'saved') {
      // Everything changed up to this sequence is in the database's sheet. The confirmation never goes backwards,
      // whatever order responses arrive in.
      if (sequence > this.acked) this.acked = sequence
      for (const [item, changedAt] of this.dirty) if (changedAt <= sequence) this.dirty.delete(item)
      this.rebase(outcome)
      this.attempts = 0
      // A change made while this save was in flight goes next, at once, whatever the clock says.
      this.send()
      this.notify()
      return
    }
    if (outcome.kind === 'stale') {
      // An older request of this tab answered after a newer one was applied: nothing of this tab's was lost, and the
      // newer request's own answer confirms it. The sheet that stands is taken as the base.
      this.rebase(outcome)
      this.send()
      this.notify()
      return
    }
    if (outcome.kind === 'refused') {
      this.refusal = outcome.status
      this.notify()
      return
    }
    // A failure: retry with backoff, never spin.
    this.attempts += 1
    if (this.attempts <= AUTOSAVE.maxRetries && this.clock() > 0 && this.inFlight.size === 0) {
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
