// lib/bookmarks/contract.ts — Types and per-request bounds for account bookmarks.

// Bounds one reconciliation request/receipt (mirrored in the database function).
// It is not an account limit: a larger local set is split into several receipts.
export const MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE = 32

// Bounds application waiting, not server execution. Writes are never aborted:
// a deadline leaves the lane quarantined until the underlying request settles.
export const BOOKMARK_REQUEST_DEADLINE_MS = 10_000

/** Built-course aliases used only to read the existing local bookmark format. */
export type BookmarkCourseAlias = {
  slug: string
  code: string
  contentKey: string
}

/** Server-resolved stable identity for a built repository course. */
export type BookmarkCourseIdentity = { contentKey: string; courseId: string }

export type BookmarkAccountResult =
  | { status: 'ready'; courseKeys: string[]; continuityToken: string; ownerMarker: string;
      courseIds?: BookmarkCourseIdentity[] }
  | { status: 'signed-out' | 'session-changed' | 'invalid-request' | 'unavailable' }

export type BookmarkSnapshot = {
  mode: 'loading' | 'local' | 'account' | 'unavailable'
  keys: ReadonlyArray<string>
}

export const LOADING_BOOKMARKS: BookmarkSnapshot = { mode: 'loading', keys: [] }

export type BookmarkTransport = {
  read(signal?: AbortSignal): Promise<BookmarkAccountResult>
  verify(token: string, signal?: AbortSignal): Promise<'same' | 'changed' | 'unavailable'>
  write(command: { action: 'merge'; reconciliationId: string; courseIds: string[] } |
    { action: 'add' | 'remove'; contentKey: string }, token: string): Promise<BookmarkAccountResult>
}

/** How a store treats a signed-out read. `closed` serves account-gated pages:
 * losing the session there fails closed instead of starting anonymous bookmarking.
 * Legacy device keys stay readable and are still imported after a verified sign-in.
 */
export type SignedOutBookmarkMode = 'local' | 'closed'
