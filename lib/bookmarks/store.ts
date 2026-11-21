// lib/bookmarks/store.ts — Shared local/account state and bounded import replay.

import { readAnonymousKeys, writeAnonymousKeys } from './local'
import { reconcileBookmarkImports } from './reconcile'
import type { AcknowledgedBookmarkImport } from './reconcile'
import { LOADING_BOOKMARKS } from './contract'
import type { BookmarkAccountResult, BookmarkCourseAlias, BookmarkSnapshot, BookmarkTransport, SignedOutBookmarkMode } from './contract'
import { BookmarkDeadlineError, withBookmarkDeadline } from './deadline'
import { BookmarkIntents } from './intents'

export { LOADING_BOOKMARKS } from './contract'
export type { BookmarkSnapshot, BookmarkTransport, SignedOutBookmarkMode } from './contract'

/** Shared state for all bookmark controls in one document. Account state is
 * never copied into anonymous storage, and failed writes never update it.
 */
export class BookmarkStore {
  private snapshot: BookmarkSnapshot = LOADING_BOOKMARKS
  private listeners = new Set<() => void>()
  private catalog: ReadonlyArray<BookmarkCourseAlias> = []
  private token: string | null = null
  private owner: string | null = null
  private generation = 0
  private started = false
  private localWriteFailed = false
  private localFallback: BookmarkSnapshot = LOADING_BOOKMARKS
  private intents = new BookmarkIntents()
  private draining = false
  private rawWrite: Promise<BookmarkAccountResult> | null = null
  private quarantined = false
  private refreshFlight: Promise<void> | null = null
  private refreshPending = false
  private refreshRetry = 0
  private refreshReadOnly = false
  private acknowledgedImport: AcknowledgedBookmarkImport | null = null
  private checkingFailure = false

  constructor(
    private readonly storage: () => Storage,
    private readonly transport: BookmarkTransport,
    private readonly notifyAccountChange: () => void = () => {},
    private readonly signedOutMode: SignedOutBookmarkMode = 'local',
  ) {}

  getSnapshot = (): BookmarkSnapshot => this.snapshot
  getServerSnapshot = (): BookmarkSnapshot => LOADING_BOOKMARKS
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private setSnapshot(snapshot: BookmarkSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  private readLocal(fallbackKeys?: ReadonlyArray<string>): string[] {
    const fallback = fallbackKeys ?? (this.snapshot.mode === 'local' ? this.snapshot.keys : [])
    if (this.localWriteFailed) return [...fallback]
    try { return readAnonymousKeys(this.storage(), fallback) }
    catch { return [...fallback] }
  }

  private writeLocal(keys: string[]): void {
    try { this.localWriteFailed = !writeAnonymousKeys(this.storage(), keys) }
    catch { this.localWriteFailed = true }
  }

  configure(catalog: ReadonlyArray<BookmarkCourseAlias>): void {
    this.catalog = catalog
    this.intents.configure(catalog)
  }

  ensureLoaded(): void {
    if (this.started) return
    this.started = true
    void this.refresh()
  }

  private unavailable(): void {
    this.token = null
    this.owner = null
    this.setSnapshot({ mode: 'unavailable', keys: [] })
  }

  private async readOnly<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    return withBookmarkDeadline(operation(controller.signal), () => controller.abort())
  }

  // All account writes, including reconciliation, cross this single lane.
  private async write(command: Parameters<BookmarkTransport['write']>[0], token: string, owner = this.owner): Promise<BookmarkAccountResult> {
    const raw = this.transport.write(command, token)
    this.rawWrite = raw
    let timedOut = false
    const settled = (result?: BookmarkAccountResult) => {
      if (this.rawWrite !== raw) return
      this.rawWrite = null
      // A late acknowledgement is not installed. Re-read before admitting writes.
      if (timedOut) {
        if (command.action === 'merge' && result?.status === 'ready' && result.ownerMarker === owner) {
          this.acknowledgedImport = { ownerMarker: result.ownerMarker,
            reconciliationId: command.reconciliationId, courseIds: [...command.courseIds] }
        }
        void this.requestRefresh(0, true)
      }
    }
    void raw.then(settled, () => settled())
    return withBookmarkDeadline(raw, () => {
      timedOut = true
      this.quarantined = true
      ++this.generation
      this.intents.fail()
      this.unavailable()
    })
  }

  /** Invalidate old-account work immediately; coalesce demand to one latest rerun.
   * Refresh cannot overtake an active/uncertain write, including a merge.
   */
  refresh(retry = 0): Promise<void> {
    return this.requestRefresh(retry, false)
  }

  private requestRefresh(retry: number, readOnly: boolean): Promise<void> {
    if (this.snapshot.mode !== 'loading' && !this.quarantined) this.localFallback = this.snapshot
    ++this.generation
    this.token = null
    this.owner = null
    this.intents.fail()
    if (this.quarantined) this.unavailable()
    else this.setSnapshot(LOADING_BOOKMARKS)
    this.refreshPending = true
    this.refreshRetry = retry
    this.refreshReadOnly = readOnly
    return this.startRefresh()
  }

  private startRefresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight
    if (this.draining || this.rawWrite) return Promise.resolve()
    this.refreshFlight = (async () => {
      do {
        this.refreshPending = false
        await this.load(this.generation, this.refreshRetry, this.refreshReadOnly)
      } while (this.refreshPending && !this.rawWrite)
    })().finally(() => {
      this.refreshFlight = null
      if (this.refreshPending && !this.rawWrite && !this.draining) void this.startRefresh()
      else if (this.intents.next()) void this.drain()
    })
    return this.refreshFlight
  }

  private retryChanged(retry: number, readOnly: boolean): void {
    if (retry === 0) void this.requestRefresh(1, readOnly)
    else this.unavailable()
  }

  private async load(generation: number, retry: number, readOnly: boolean): Promise<void> {
    const previous = this.localFallback
    let result: BookmarkAccountResult
    try { result = await this.readOnly(signal => this.transport.read(signal)) }
    catch { result = { status: 'unavailable' } }
    if (generation !== this.generation) return
    if (result.status === 'signed-out' && this.signedOutMode === 'closed') { this.unavailable(); return }
    if (result.status === 'signed-out') {
      this.quarantined = false
      if (previous.mode !== 'local') this.localWriteFailed = false
      this.setSnapshot({ mode: 'local', keys: this.readLocal(previous.mode === 'local' ? previous.keys : []) })
      return
    }
    if (result.status !== 'ready') { this.unavailable(); return }
    if (!result.courseIds) { this.unavailable(); return }
    const courseIds = result.courseIds
    try {
      const checkedToken = result.continuityToken
      const checked = await this.readOnly(signal => this.transport.verify(checkedToken, signal))
      if (generation !== this.generation) return
      if (checked === 'changed') { this.retryChanged(retry, readOnly); return }
      if (checked !== 'same') { this.unavailable(); return }
      const expectedOwner = result.ownerMarker
      const merged = await reconcileBookmarkImports(this.storage(), this.catalog, courseIds, result,
        (command, token) => this.write(command, token, expectedOwner), () => generation === this.generation,
        this.acknowledgedImport, readOnly)
      if (merged === null) return
      if (merged.status === 'session-changed' || merged.status === 'signed-out') { this.retryChanged(retry, readOnly); return }
      if (merged.status !== 'ready') { this.unavailable(); return }
      result = merged
      const finalToken = result.continuityToken
      const finalCheck = await this.readOnly(signal => this.transport.verify(finalToken, signal))
      if (generation !== this.generation) return
      if (finalCheck === 'changed') { this.retryChanged(retry, readOnly); return }
      if (finalCheck !== 'same') { this.unavailable(); return }
      this.quarantined = false
      this.token = result.continuityToken
      this.owner = result.ownerMarker
      this.setSnapshot({ mode: 'account', keys: result.courseKeys })
    } catch { if (generation === this.generation) this.unavailable() }
  }

  /** Native cross-tab storage events update anonymous views without a reload. */
  onAnonymousStorageChange(): void {
    if (this.snapshot.mode === 'local') {
      this.localWriteFailed = false
      this.setSnapshot({ mode: 'local', keys: this.readLocal() })
    } else if (this.snapshot.mode === 'account') {
      void this.refresh()
    }
  }

  private async failedWrite(token: string, generation: number): Promise<void> {
    this.checkingFailure = true
    try {
      let checked: 'same' | 'changed' | 'unavailable'
      try { checked = await this.readOnly(signal => this.transport.verify(token, signal)) }
      catch { checked = 'unavailable' }
      if (generation !== this.generation) return
      if (checked === 'changed') void this.refresh()
      else if (checked === 'unavailable') this.unavailable()
    } finally { this.checkingFailure = false }
  }

  private async drain(): Promise<void> {
    if (this.draining || this.refreshFlight || this.refreshPending || this.rawWrite || this.quarantined) return
    this.draining = true
    try {
      while (this.snapshot.mode === 'account' && this.token && this.owner && !this.quarantined) {
        const intent = this.intents.next()
        if (!intent) break
        if (this.snapshot.keys.includes(intent.key) === intent.desired) {
          this.intents.finish(intent, intent.desired ? 'added' : 'removed')
          continue
        }
        const generation = this.generation, token = this.token, owner = this.owner, desired = intent.desired
        let result: BookmarkAccountResult
        try { result = await this.write({ action: desired ? 'add' : 'remove', contentKey: intent.key }, token) }
        catch (error) {
          if (!(error instanceof BookmarkDeadlineError) && generation === this.generation) await this.failedWrite(token, generation)
          this.intents.fail()
          break
        }
        if (generation !== this.generation) { this.intents.fail(); this.refreshPending = true; break }
        if (result.status === 'signed-out' || result.status === 'session-changed') { void this.refresh(); break }
        if (result.status !== 'ready') { await this.failedWrite(token, generation); this.intents.fail(); break }
        if (result.ownerMarker !== owner || result.courseKeys.includes(intent.key) !== desired) { this.intents.fail(); this.unavailable(); break }
        let verified: 'same' | 'changed' | 'unavailable'
        try { verified = await this.readOnly(signal => this.transport.verify(result.continuityToken, signal)) }
        catch { verified = 'unavailable' }
        if (generation !== this.generation) { this.intents.fail(); this.refreshPending = true; break }
        if (verified === 'changed') { void this.refresh(); break }
        if (verified !== 'same') { this.intents.fail(); this.unavailable(); break }
        this.token = result.continuityToken
        this.setSnapshot({ mode: 'account', keys: result.courseKeys })
        this.notifyAccountChange()
      }
    } catch { this.intents.fail(); this.unavailable() } finally {
      this.draining = false
      if (this.refreshPending && !this.rawWrite) void this.startRefresh()
      else if (this.intents.next() && !this.quarantined && !this.rawWrite) void this.drain()
    }
  }

  /** Toggle the latest desired state while rendering only confirmed durable state. */
  toggle(course: BookmarkCourseAlias): Promise<'added' | 'removed' | null> {
    if (this.snapshot.mode === 'local' && this.signedOutMode === 'local') {
      const keys = this.readLocal()
      const had = keys.includes(course.slug) || keys.includes(course.code)
      const next = had ? keys.filter(key => key !== course.slug && key !== course.code)
        : [...keys, course.slug]
      this.writeLocal(next)
      this.setSnapshot({ mode: 'local', keys: next })
      return Promise.resolve(had ? 'removed' : 'added')
    }
    if (this.snapshot.mode !== 'account' || this.quarantined || this.checkingFailure) return Promise.resolve(null)
    const intent = this.intents.request(course.contentKey, 'toggle', this.snapshot.keys.includes(course.contentKey))
    if (!intent) return Promise.resolve(null)
    void this.drain()
    return intent.completion
  }

  /** /bookmarks removes the same durable identity as the course-page button. */
  remove(course: BookmarkCourseAlias): Promise<boolean> {
    if (this.snapshot.mode === 'local' && this.signedOutMode === 'local') {
      const next = this.readLocal().filter(key =>
        key !== course.slug && key !== course.code)
      this.writeLocal(next)
      this.setSnapshot({ mode: 'local', keys: next })
      return Promise.resolve(true)
    }
    if (this.snapshot.mode !== 'account' || this.quarantined || this.checkingFailure) return Promise.resolve(false)
    const intent = this.intents.request(course.contentKey, 'remove', this.snapshot.keys.includes(course.contentKey))
    if (!intent) return Promise.resolve(false)
    void this.drain()
    return intent.removal
  }
}
