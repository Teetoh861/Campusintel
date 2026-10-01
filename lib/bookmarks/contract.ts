// lib/bookmarks/contract.ts — Types and per-request bounds for account bookmarks.

// Bounds one reconciliation request/receipt (mirrored in the database function).
// It is not an account limit: a larger local set is split into several receipts.
export const MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE = 32

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
