// lib/ai-practice/cleanup.ts — Retention enforcement for personal uploads and sets (service role only).
// Order matters: Storage objects are removed first, then expired rows are purged. The purge keeps any
// expired document whose object still exists, so an interrupted or batch-limited run never strands a file.
// The same sweep is the Account-purge pre-step: objects of deletion-scheduled accounts are removed first.
import 'server-only'
import { timingSafeEqual } from 'node:crypto'

const BUCKET = 'ai-practice-uploads'
const BATCH_SIZE = 100
const MAX_BATCHES = 20
const MIN_SECRET_BYTES = 32

type RpcResult = PromiseLike<{ data: unknown; error: unknown }>
type StorageResult = Promise<{ data: unknown; error: unknown }>

/** The narrow service-role surface cleanup needs; tests inject a fake. */
export type CleanupClient = {
  rpc(name: string, args?: Record<string, unknown>): RpcResult
  storage: { from(bucket: string): {
    remove(paths: string[]): StorageResult
    list(prefix: string, options: { limit: number; offset: number }): Promise<{ data: { name: string }[] | null; error: unknown }>
  } }
}

const PURGE_COUNTS = ['deleted_sets', 'deleted_documents', 'expired_upload_slots', 'retained_documents',
  'outstanding_uploads', 'purge_blocking_uploads'] as const

export type CleanupReport = {
  /** No step failed. */
  ok: boolean
  /** Nothing is left to remove: every stale object is gone and no expired row is held back by one. */
  complete: boolean
  removedUploads: number
  purge: Record<(typeof PURGE_COUNTS)[number], number> | null
}

function isPurgeReport(value: unknown): value is NonNullable<CleanupReport['purge']> {
  return typeof value === 'object' && value !== null &&
    PURGE_COUNTS.every(key => Number.isInteger((value as Record<string, unknown>)[key]))
}

/**
 * Remove stale upload objects in bounded batches, then purge rows past their retention. A run that hits the
 * batch limit still purges what is safe and reports complete: false with the outstanding counts.
 */
export async function runAiPracticeCleanup(client: CleanupClient): Promise<CleanupReport> {
  let removedUploads = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const listed = await client.rpc('list_ai_practice_uploads_to_remove', { p_limit: BATCH_SIZE })
    if (listed.error || !Array.isArray(listed.data) || !listed.data.every(name => typeof name === 'string')) {
      return { ok: false, complete: false, removedUploads, purge: null }
    }
    const names = listed.data as string[]
    if (names.length === 0) break
    const removed = await client.storage.from(BUCKET).remove(names)
    if (removed.error) return { ok: false, complete: false, removedUploads, purge: null }
    removedUploads += names.length
    if (names.length < BATCH_SIZE) break
  }
  const purged = await client.rpc('purge_expired_ai_practice')
  if (purged.error || !isPurgeReport(purged.data)) return { ok: false, complete: false, removedUploads, purge: null }
  const complete = purged.data.outstanding_uploads === 0 && purged.data.retained_documents === 0
  return { ok: true, complete, removedUploads, purge: purged.data }
}

/**
 * Account-deletion integration: remove every upload object under the student's folder.
 * Database rows cascade from auth.users; Storage objects do not, and the Account worker fails closed (P0002)
 * while any remain. runAiPracticeCleanup covers every scheduled account first; this is the per-account form.
 */
export async function removeAiPracticeUploadsForUser(client: CleanupClient, userId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return false
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const listed = await client.storage.from(BUCKET).list(userId, { limit: BATCH_SIZE, offset: 0 })
    if (listed.error || listed.data === null) return false
    if (listed.data.length === 0) return true
    const removed = await client.storage.from(BUCKET).remove(listed.data.map(entry => `${userId}/${entry.name}`))
    if (removed.error) return false
  }
  return false
}

/** Constant-time bearer check against a long, server-only secret; a weak or missing secret disables the route. */
export function isAuthorizedCleanupRequest(header: string | null, secret: string | undefined): boolean {
  if (!secret || Buffer.byteLength(secret) < MIN_SECRET_BYTES || !header?.startsWith('Bearer ')) return false
  const expected = Buffer.from(secret)
  const supplied = Buffer.from(header.slice('Bearer '.length))
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
