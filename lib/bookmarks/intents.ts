import type { BookmarkCourseAlias } from './contract'

export type BookmarkMutationResult = 'added' | 'removed' | null
type Intent = {
  key: string; desired: boolean; completion: Promise<BookmarkMutationResult>; removal: Promise<boolean>
  resolve: (result: BookmarkMutationResult) => void
}

/** One completion per configured course burst, never a waiter/task per click. */
export class BookmarkIntents {
  private configured = new Set<string>()
  private pending = new Map<string, Intent>()

  configure(catalog: ReadonlyArray<BookmarkCourseAlias>): void {
    this.configured = new Set(catalog.map(course => course.contentKey))
    for (const intent of this.pending.values()) if (!this.configured.has(intent.key)) this.finish(intent, null)
  }

  request(key: string, action: 'toggle' | 'remove', saved: boolean): Intent | null {
    if (!this.configured.has(key)) return null
    let intent = this.pending.get(key)
    if (!intent) {
      let resolve!: Intent['resolve']
      const completion = new Promise<BookmarkMutationResult>(done => { resolve = done })
      intent = { key, desired: saved, completion, removal: completion.then(result => result === 'removed'), resolve }
      this.pending.set(key, intent)
    }
    intent.desired = action === 'toggle' ? !intent.desired : false
    return intent
  }

  next(): Intent | undefined { return this.pending.values().next().value }

  finish(intent: Intent, result: BookmarkMutationResult): void {
    if (this.pending.get(intent.key) !== intent) return
    this.pending.delete(intent.key)
    intent.resolve(result)
  }

  fail(): void { for (const intent of this.pending.values()) this.finish(intent, null) }
}
