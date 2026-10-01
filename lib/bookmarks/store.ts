// lib/bookmarks/store.ts — Shared local/account state and bounded import replay.

import { claimAnonymousKeys, consumeClaimedKeys, readAnonymousKeys,
  writeAnonymousKeys } from './local'
import type { BookmarkAccountResult, BookmarkCourseAlias } from './contract'

export type BookmarkSnapshot = {
  mode: 'loading' | 'local' | 'account' | 'unavailable'
  keys: ReadonlyArray<string>
}

export const LOADING_BOOKMARKS: BookmarkSnapshot = { mode: 'loading', keys: [] }

export type BookmarkTransport = {
  read(): Promise<BookmarkAccountResult>
  verify(token: string): Promise<'same' | 'changed' | 'unavailable'>
  write(command: { action: 'merge'; reconciliationId: string; courseIds: string[] } |
    { action: 'add' | 'remove'; contentKey: string }, token: string): Promise<BookmarkAccountResult>
}

/** How a store treats a signed-out read. `closed` serves account-gated pages:
 * losing the session there fails closed instead of starting anonymous bookmarking.
 * Legacy device keys stay readable and are still imported after a verified sign-in.
 */
export type SignedOutBookmarkMode = 'local' | 'closed'

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
  private writeQueue: Promise<unknown> = Promise.resolve()

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
  }

  ensureLoaded(): void {
    if (this.started) return
    this.started = true
    void this.refresh()
  }

  /** Clear account data before each live-session check, including focus and
   * account-change notifications. A late result from an old check is ignored.
   */
  async refresh(retry = 0): Promise<void> {
    const previous = this.snapshot
    const generation = ++this.generation
    this.token = null
    this.owner = null
    this.setSnapshot(LOADING_BOOKMARKS)
    let result: BookmarkAccountResult
    try { result = await this.transport.read() }
    catch { result = { status: 'unavailable' } }
    if (generation !== this.generation) return
    if (result.status === 'signed-out' && this.signedOutMode === 'closed') {
      this.setSnapshot({ mode: 'unavailable', keys: [] })
      return
    }
    if (result.status === 'signed-out') {
      if (previous.mode !== 'local') this.localWriteFailed = false
      this.setSnapshot({ mode: 'local', keys: this.readLocal(previous.mode === 'local' ? previous.keys : []) })
      return
    }
    if (result.status !== 'ready') {
      this.setSnapshot({ mode: 'unavailable', keys: [] })
      return
    }
    if (!result.courseIds) {
      this.setSnapshot({ mode: 'unavailable', keys: [] })
      return
    }
    const courseIds = result.courseIds
    try {
      const checked = await this.transport.verify(result.continuityToken)
      if (generation !== this.generation) return
      if (checked === 'changed') {
        if (retry === 0) await this.refresh(1)
        else this.setSnapshot({ mode: 'unavailable', keys: [] })
        return
      }
      if (checked !== 'same') {
        this.setSnapshot({ mode: 'unavailable', keys: [] })
        return
      }
      let pending = claimAnonymousKeys(this.storage(), result.ownerMarker, this.catalog, courseIds)
      while (pending) {
        for (const batch of pending.batches) {
          const merge = await this.transport.write({ action: 'merge',
            reconciliationId: batch.id, courseIds: batch.courseIds }, result.continuityToken)
          if (generation !== this.generation) return
          if (merge.status === 'session-changed' || merge.status === 'signed-out') {
            void this.refresh()
            return
          }
          if (merge.status !== 'ready' || merge.ownerMarker !== result.ownerMarker) {
            this.setSnapshot({ mode: 'unavailable', keys: [] })
            return
          }
          result = merge
        }
        consumeClaimedKeys(this.storage(), result.ownerMarker, pending.id)
        pending = claimAnonymousKeys(this.storage(), result.ownerMarker, this.catalog, courseIds)
      }
      const finalCheck = await this.transport.verify(result.continuityToken)
      if (generation !== this.generation) return
      if (finalCheck === 'changed') {
        if (retry === 0) await this.refresh(1)
        else this.setSnapshot({ mode: 'unavailable', keys: [] })
        return
      }
      if (finalCheck !== 'same') {
        this.setSnapshot({ mode: 'unavailable', keys: [] })
        return
      }
      this.token = result.continuityToken
      this.owner = result.ownerMarker
      this.setSnapshot({ mode: 'account', keys: result.courseKeys })
    } catch { if (generation === this.generation) this.setSnapshot({ mode: 'unavailable', keys: [] }) }
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

  private enqueue(action: 'toggle' | 'remove', course: BookmarkCourseAlias): Promise<'added' | 'removed' | null> {
    const generation = this.generation
    const task = async (): Promise<'added' | 'removed' | null> => {
      if (generation !== this.generation || this.snapshot.mode !== 'account' || !this.token || !this.owner) return null
      const token = this.token
      const owner = this.owner
      const operation = action === 'toggle' && this.snapshot.keys.includes(course.contentKey) ? 'remove'
        : action === 'toggle' ? 'add' : 'remove'
      const failedWrite = async (): Promise<null> => {
        let checked: 'same' | 'changed' | 'unavailable'
        try { checked = await this.transport.verify(token) }
        catch { checked = 'unavailable' }
        if (generation !== this.generation) return null
        if (checked === 'changed') void this.refresh()
        else if (checked === 'unavailable') {
          this.token = null
          this.owner = null
          this.setSnapshot({ mode: 'unavailable', keys: [] })
        }
        return null
      }
      let result: BookmarkAccountResult
      try { result = await this.transport.write({ action: operation, contentKey: course.contentKey }, token) }
      catch { return failedWrite() }
      if (generation !== this.generation) {
        // A focus or account-change check raced this write. Re-read the live
        // account after its response so a successful old request is visible.
        void this.refresh()
        return null
      }
      if (result.status === 'signed-out' || result.status === 'session-changed') {
        void this.refresh()
        return null
      }
      if (result.status !== 'ready') return failedWrite()
      if (result.ownerMarker !== owner) {
        this.token = null
        this.owner = null
        this.setSnapshot({ mode: 'unavailable', keys: [] })
        return null
      }
      let verified: 'same' | 'changed' | 'unavailable'
      try { verified = await this.transport.verify(result.continuityToken) }
      catch { verified = 'unavailable' }
      if (generation !== this.generation) { void this.refresh(); return null }
      if (verified === 'changed') { void this.refresh(); return null }
      if (verified !== 'same') {
        this.token = null
        this.owner = null
        this.setSnapshot({ mode: 'unavailable', keys: [] })
        return null
      }
      this.token = result.continuityToken
      this.setSnapshot({ mode: 'account', keys: result.courseKeys })
      this.notifyAccountChange()
      return operation === 'add' ? 'added' : 'removed'
    }
    const queued = this.writeQueue.then(task, task)
    this.writeQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  /** Toggle with the latest settled state, so rapid clicks cannot lose intent. */
  async toggle(course: BookmarkCourseAlias): Promise<'added' | 'removed' | null> {
    if (this.snapshot.mode === 'local' && this.signedOutMode === 'local') {
      const keys = this.readLocal()
      const had = keys.includes(course.slug) || keys.includes(course.code)
      const next = had ? keys.filter(key => key !== course.slug && key !== course.code)
        : [...keys, course.slug]
      this.writeLocal(next)
      this.setSnapshot({ mode: 'local', keys: next })
      return had ? 'removed' : 'added'
    }
    if (this.snapshot.mode !== 'account') return null
    return this.enqueue('toggle', course)
  }

  /** /bookmarks removes the same durable identity as the course-page button. */
  async remove(course: BookmarkCourseAlias): Promise<boolean> {
    if (this.snapshot.mode === 'local' && this.signedOutMode === 'local') {
      const next = this.readLocal().filter(key =>
        key !== course.slug && key !== course.code)
      this.writeLocal(next)
      this.setSnapshot({ mode: 'local', keys: next })
      return true
    }
    return this.snapshot.mode === 'account' && await this.enqueue('remove', course) !== null
  }
}
