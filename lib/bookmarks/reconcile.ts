import { claimAnonymousKeys, consumeClaimedKeys } from './local'
import type { BookmarkAccountResult, BookmarkCourseAlias, BookmarkCourseIdentity, BookmarkTransport } from './contract'

export type AcknowledgedBookmarkImport = {
  ownerMarker: string; reconciliationId: string; courseIds: string[]
}

/** Replay only the existing pinned import receipts, through the store's write lane.
 * Generation checks prevent an old-account acknowledgement consuming local escrow.
 */
export async function reconcileBookmarkImports(
  storage: Storage, catalog: ReadonlyArray<BookmarkCourseAlias>,
  identities: ReadonlyArray<BookmarkCourseIdentity>, initial: Extract<BookmarkAccountResult, { status: 'ready' }>,
  write: BookmarkTransport['write'], isCurrent: () => boolean,
  acknowledged: AcknowledgedBookmarkImport | null = null, readOnlyRecovery = false,
): Promise<BookmarkAccountResult | null> {
  let result = initial
  let pending = claimAnonymousKeys(storage, result.ownerMarker, catalog, identities)
  while (pending) {
    for (const batch of pending.batches) {
      // A late matching acknowledgement proves receipt completion, not current
      // bookmark state. The GET remains the only source of the recovered view.
      if (acknowledged?.ownerMarker === result.ownerMarker && acknowledged.reconciliationId === batch.id &&
          JSON.stringify(acknowledged.courseIds) === JSON.stringify(batch.courseIds)) continue
      // Automatic timeout recovery is read-only. Unacknowledged imports need a
      // deliberate later refresh to replay their existing receipt safely.
      if (readOnlyRecovery) return { status: 'unavailable' }
      const merge = await write({ action: 'merge', reconciliationId: batch.id, courseIds: batch.courseIds }, result.continuityToken)
      if (!isCurrent()) return null
      if (merge.status !== 'ready') return merge
      if (merge.ownerMarker !== result.ownerMarker) return { status: 'unavailable' }
      result = merge
    }
    consumeClaimedKeys(storage, result.ownerMarker, pending.id)
    pending = claimAnonymousKeys(storage, result.ownerMarker, catalog, identities)
  }
  return result
}
