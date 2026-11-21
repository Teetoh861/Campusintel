// lib/bookmarks/local.ts — Untrusted anonymous storage and account import escrow.

import { MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE } from './contract'
import type { BookmarkCourseAlias, BookmarkCourseIdentity } from './contract'

export const BOOKMARK_STORAGE_KEY = 'ci_bookmarks_v1'

const CLAIM_KEY = 'ci_bookmarks_v1_claim'
const PENDING_PREFIX = 'ci_bookmarks_v1_pending:'
const LEGACY_CLAIMED_KEY = 'ci_bookmarks_v1_legacy_claimed'
const ANONYMOUS_ORIGIN_KEY = 'ci_bookmarks_v1_anonymous_origin'
// Bound untrusted browser storage without imposing an account bookmark limit.
// 64 KiB holds roughly a thousand legacy keys; 256 KiB fits a claim (that raw
// copy plus its course-UUID batches).
const MAX_RAW_LENGTH = 64 * 1024
const MAX_MIGRATION_LENGTH = 256 * 1024
// Longer than any built slug or course code; longer entries cannot match.
const MAX_LOCAL_KEY_LENGTH = 63
const MARKER_FORMAT = /^[A-Za-z0-9_-]{43}$/
const RECONCILIATION_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COURSE_ID_FORMAT = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

type Batch = { id: string; courseIds: string[] }
type Claim = { owner: string; id: string; raw: string; batches: Batch[] }
type Pending = { id: string; consumed: boolean; batches: Batch[] }
export type PendingBookmarkImport = { id: string; batches: Batch[] }

/** Parse the existing JSON string array without trusting its shape or entries. */
export function parseLocalBookmarkKeys(raw: string | null): string[] {
  if (raw === null || raw.length > MAX_RAW_LENGTH) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string =>
      typeof item === 'string' && item.length > 0 && item.length <= MAX_LOCAL_KEY_LENGTH))]
  } catch { return [] }
}

/** Match legacy slugs or course codes only against built repository courses. */
export function resolveLocalCourseKeys(
  keys: ReadonlyArray<string>, catalog: ReadonlyArray<BookmarkCourseAlias>,
): string[] {
  const byAlias = new Map<string, string>()
  for (const course of catalog) {
    byAlias.set(course.slug, course.contentKey)
    byAlias.set(course.code, course.contentKey)
  }
  return [...new Set(keys.map(key => byAlias.get(key)).filter((key): key is string => key !== undefined))]
}

/** Read signed-out bookmarks, hiding a legacy snapshot already claimed by an
 * account. Unavailable storage returns the caller's in-memory fallback.
 */
export function readAnonymousKeys(storage: Storage, fallback: ReadonlyArray<string> = []): string[] {
  try {
    const raw = storage.getItem(BOOKMARK_STORAGE_KEY)
    if (storage.getItem(LEGACY_CLAIMED_KEY) === '1' &&
        storage.getItem(ANONYMOUS_ORIGIN_KEY) !== raw) return []
    return parseLocalBookmarkKeys(raw)
  }
  catch { return [...fallback] }
}

/** Preserve the signed-out storage contract and its in-memory fallback. */
export function writeAnonymousKeys(storage: Storage, keys: ReadonlyArray<string>): boolean {
  try {
    const raw = JSON.stringify(keys)
    storage.setItem(ANONYMOUS_ORIGIN_KEY, raw)
    storage.setItem(BOOKMARK_STORAGE_KEY, raw)
    return true
  }
  catch { return false }
}

function parseBatches(value: unknown): Batch[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid bookmark batches')
  const batches = value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid bookmark batch')
    const batch = item as Record<string, unknown>
    if (typeof batch.id !== 'string' || !RECONCILIATION_ID_FORMAT.test(batch.id) ||
        !Array.isArray(batch.courseIds) ||
        batch.courseIds.length > MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) {
      throw new Error('Invalid bookmark batch')
    }
    const courseIds: string[] = []
    for (const id of batch.courseIds) {
      if (typeof id !== 'string' || !COURSE_ID_FORMAT.test(id)) throw new Error('Invalid course identity')
      courseIds.push(id)
    }
    return { id: batch.id, courseIds }
  })
  if (new Set(batches.map(batch => batch.id)).size !== batches.length) {
    throw new Error('Duplicate bookmark batch')
  }
  return batches
}

function parseClaim(raw: string): Claim {
  if (raw.length > MAX_MIGRATION_LENGTH) throw new Error('Invalid bookmark claim')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid bookmark claim')
  const claim = parsed as Record<string, unknown>
  if (typeof claim.owner !== 'string' || !MARKER_FORMAT.test(claim.owner) ||
      typeof claim.id !== 'string' || !RECONCILIATION_ID_FORMAT.test(claim.id) ||
      typeof claim.raw !== 'string' || claim.raw.length > MAX_RAW_LENGTH) {
    throw new Error('Invalid bookmark claim')
  }
  const batches = parseBatches(claim.batches)
  if (claim.id !== batches[0].id) throw new Error('Invalid bookmark claim identity')
  return { owner: claim.owner, id: claim.id, raw: claim.raw, batches }
}

function pendingKey(owner: string): string {
  if (!MARKER_FORMAT.test(owner)) throw new Error('Invalid bookmark owner marker')
  return PENDING_PREFIX + owner
}

function readPending(storage: Storage, owner: string): Pending | null {
  const raw = storage.getItem(pendingKey(owner))
  if (raw === null) return null
  if (raw.length > MAX_MIGRATION_LENGTH) throw new Error('Invalid bookmark migration')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid bookmark migration')
  const pending = parsed as Record<string, unknown>
  if (typeof pending.id !== 'string' || !RECONCILIATION_ID_FORMAT.test(pending.id) ||
      typeof pending.consumed !== 'boolean') throw new Error('Invalid bookmark migration')
  const batches = parseBatches(pending.batches)
  if (pending.id !== batches[0].id) throw new Error('Invalid bookmark migration identity')
  return { id: pending.id, consumed: pending.consumed, batches }
}

function finishInterruptedClaim(storage: Storage): void {
  const raw = storage.getItem(CLAIM_KEY)
  if (raw === null) return
  const claim = parseClaim(raw)
  const pending = readPending(storage, claim.owner)
  if (pending && !pending.consumed && pending.id !== claim.id) {
    throw new Error('Another bookmark import is pending')
  }
  if (!pending || pending.id !== claim.id) {
    storage.setItem(pendingKey(claim.owner), JSON.stringify({ id: claim.id,
      consumed: false, batches: claim.batches } satisfies Pending))
  } else if (!pending.consumed && JSON.stringify(pending.batches) !== JSON.stringify(claim.batches)) {
    throw new Error('Bookmark import changed during claim')
  }
  // A later anonymous edit must remain in the shared local key. The claim
  // covers only the exact snapshot it captured before the move began.
  if (storage.getItem(BOOKMARK_STORAGE_KEY) === claim.raw) {
    storage.removeItem(BOOKMARK_STORAGE_KEY)
    if (storage.getItem(ANONYMOUS_ORIGIN_KEY) === claim.raw) storage.removeItem(ANONYMOUS_ORIGIN_KEY)
  }
  storage.removeItem(CLAIM_KEY)
}

/** Move anonymous keys to a private account escrow before any server merge.
 * A failed merge leaves the escrow for that same account to retry. A claim
 * protects the brief two-key move from a crash or account switch.
 */
export function claimAnonymousKeys(
  storage: Storage, owner: string, catalog: ReadonlyArray<BookmarkCourseAlias>,
  identities: ReadonlyArray<BookmarkCourseIdentity>,
): PendingBookmarkImport | null {
  pendingKey(owner)
  finishInterruptedClaim(storage)
  const existing = readPending(storage, owner)
  // An import's payload is immutable after its first request. Later anonymous
  // edits remain in the shared key until this batch is acknowledged.
  if (existing && !existing.consumed) return { id: existing.id, batches: existing.batches }
  const raw = storage.getItem(BOOKMARK_STORAGE_KEY)
  const legacyClaimed = storage.getItem(LEGACY_CLAIMED_KEY) === '1'
  const origin = storage.getItem(ANONYMOUS_ORIGIN_KEY)
  const eligible = raw !== null && (!legacyClaimed || origin === raw)
  const keys = eligible ? parseLocalBookmarkKeys(raw) : []
  if (eligible && keys.length) {
    const byKey = new Map(identities.map(identity => [identity.contentKey, identity.courseId]))
    const courseIds = resolveLocalCourseKeys(keys, catalog).map(key => {
      const id = byKey.get(key)
      if (!id) throw new Error('Bookmark registry mismatch')
      return id
    })
    const batches: Batch[] = []
    for (let offset = 0; offset < courseIds.length; offset += MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) {
      batches.push({ id: globalThis.crypto.randomUUID(),
        courseIds: courseIds.slice(offset, offset + MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) })
    }
    // An all-unknown legacy snapshot still receives a receipt, so it cannot
    // acquire newly recognized aliases during a later retry.
    if (!batches.length) batches.push({ id: globalThis.crypto.randomUUID(), courseIds: [] })
    storage.setItem(CLAIM_KEY, JSON.stringify({ owner, id: batches[0].id,
      raw, batches } satisfies Claim))
    storage.setItem(LEGACY_CLAIMED_KEY, '1')
    finishInterruptedClaim(storage)
  } else if (!legacyClaimed) {
    // The first live account closes the one-time legacy import window even if
    // there was no local data. Later signed-out writes carry their own origin.
    storage.setItem(LEGACY_CLAIMED_KEY, '1')
  }
  const pending = readPending(storage, owner)
  return pending?.consumed ? null : pending ? { id: pending.id, batches: pending.batches } : null
}

/** Consume migration data only after the server confirms the union.
 * If removal fails, a consumed tombstone still prevents a later re-import.
 */
export function consumeClaimedKeys(storage: Storage, owner: string, id: string): void {
  const key = pendingKey(owner)
  const pending = readPending(storage, owner)
  if (pending === null) return
  if (pending.id !== id) throw new Error('Bookmark import changed before acknowledgement')
  try { storage.removeItem(key); return }
  catch { storage.setItem(key, JSON.stringify({ id, consumed: true,
    batches: pending.batches } satisfies Pending)) }
}
