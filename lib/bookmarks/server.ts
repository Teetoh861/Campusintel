// lib/bookmarks/server.ts — Session-bound bookmark reads and narrow writes.
import 'server-only'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { getAuthSecretKey, isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken, matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { courses, getCourseByContentKey } from '@/lib/data/courses'
import { createClient } from '@/lib/supabase/server'
import { MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE } from './contract'
import type { NextResponse } from 'next/server'
import type { BookmarkAccountResult, BookmarkCourseIdentity } from './contract'

type StudentClient = Awaited<ReturnType<typeof createClient>>
type StudentContext = NonNullable<Awaited<ReturnType<typeof getStudentSessionContext>>>

// Keeps each PostgREST `in` filter URL short; independent of import batches.
const REGISTRY_QUERY_CHUNK_SIZE = 32
// Above any repository content key; rejects oversized request strings early.
const MAX_CONTENT_KEY_LENGTH = 100

const courseRow = z.object({ id: z.string().uuid(), content_key: z.string().min(1) })
const bookmarkRow = z.object({ course_id: z.string().uuid() })

/** Only these three bounded operations can reach account bookmark storage. */
export const bookmarkCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge'), reconciliationId: z.string().uuid(),
    courseIds: z.array(z.string().uuid()).max(MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) }).strict(),
  z.object({ action: z.literal('add'), contentKey: z.string().min(1).max(MAX_CONTENT_KEY_LENGTH) }).strict(),
  z.object({ action: z.literal('remove'), contentKey: z.string().min(1).max(MAX_CONTENT_KEY_LENGTH) }).strict(),
])
export type BookmarkCommand = z.infer<typeof bookmarkCommand>

function ownerMarker(userId: string): string {
  return createHmac('sha256', getAuthSecretKey())
    .update(JSON.stringify(['bookmark-local-migration:v1', userId]))
    .digest('base64url')
}

async function loadBookmarks(client: StudentClient, userId: string): Promise<{
  courseKeys: string[]; courseIds: string[]
}> {
  const saved = await client.from('student_bookmarks').select('course_id')
    .eq('user_id', userId).order('saved_at', { ascending: true })
  if (saved.error || !Array.isArray(saved.data)) throw new Error('Bookmark read failed')
  const savedRows = z.array(bookmarkRow).parse(saved.data)
  if (!savedRows.length) return { courseKeys: [], courseIds: [] }
  const byId = new Map<string, string>()
  for (let offset = 0; offset < savedRows.length; offset += REGISTRY_QUERY_CHUNK_SIZE) {
    const registry = await client.from('courses').select('id,content_key')
      .in('id', savedRows.slice(offset, offset + REGISTRY_QUERY_CHUNK_SIZE)
        .map(row => row.course_id))
    if (registry.error || !Array.isArray(registry.data)) throw new Error('Course read failed')
    for (const row of z.array(courseRow).parse(registry.data)) byId.set(row.id, row.content_key)
  }
  if (byId.size !== new Set(savedRows.map(row => row.course_id)).size) throw new Error('Course registry mismatch')
  return { courseIds: savedRows.map(row => row.course_id),
    courseKeys: savedRows.map(row => byId.get(row.course_id)).filter((key): key is string =>
      typeof key === 'string' && getCourseByContentKey(key) !== undefined) }
}

function ready(
  context: StudentContext, courseKeys: string[], courseIds?: BookmarkCourseIdentity[],
): BookmarkAccountResult {
  return { status: 'ready', courseKeys,
    continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId),
    ownerMarker: ownerMarker(context.user.id), ...(courseIds ? { courseIds } : {}) }
}

/** Read only the live cookie-bound student's bookmarks through their RLS client. */
export async function getCurrentBookmarks(response: NextResponse): Promise<BookmarkAccountResult> {
  if (!isStudentAuthEnabled()) return { status: 'signed-out' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    const saved = await loadBookmarks(client, context.user.id)
    const identities = await registryForKeys(client, [...new Set(courses.map(course => course.contentKey))])
    return ready(context, saved.courseKeys, [...identities].map(([contentKey, courseId]) =>
      ({ contentKey, courseId })))
  } catch { return { status: 'unavailable' } }
}

async function registryForKeys(client: StudentClient, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map()
  const uniqueKeys = [...new Set(keys)]
  const byKey = new Map<string, string>()
  for (let offset = 0; offset < uniqueKeys.length; offset += REGISTRY_QUERY_CHUNK_SIZE) {
    const result = await client.from('courses').select('id,content_key')
      .in('content_key', uniqueKeys.slice(offset, offset + REGISTRY_QUERY_CHUNK_SIZE))
    if (result.error || !Array.isArray(result.data)) throw new Error('Course registry read failed')
    for (const row of z.array(courseRow).parse(result.data)) byKey.set(row.content_key, row.id)
  }
  if (byKey.size !== uniqueKeys.length) throw new Error('Course registry mismatch')
  return byKey
}

/** Mutate only after live session and continuity checks; user_id is never request data. */
export async function writeCurrentBookmarks(
  input: BookmarkCommand, response: NextResponse, pageToken: string | null,
): Promise<BookmarkAccountResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (!pageToken || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const keys = input.action === 'merge' ? []
      : getCourseByContentKey(input.contentKey) ? [input.contentKey] : null
    if (keys === null) return { status: 'invalid-request' }
    const byKey = await registryForKeys(client, keys)
    const live = await getStudentSessionContext(response, client)
    if (live === null) return { status: 'signed-out' }
    if (live.user.id !== context.user.id || live.sessionId !== context.sessionId) {
      return { status: 'session-changed' }
    }
    let mergeApplied = true
    if (input.action === 'merge') {
      const result = await client.rpc('reconcile_student_bookmarks', {
        p_reconciliation_id: input.reconciliationId, p_course_ids: input.courseIds,
      })
      if (result.error || typeof result.data !== 'boolean') throw new Error('Bookmark reconciliation failed')
      mergeApplied = result.data
    } else if (input.action === 'remove') {
      const courseId = byKey.get(input.contentKey)
      if (!courseId) throw new Error('Course registry mismatch')
      const result = await client.from('student_bookmarks').delete()
        .eq('user_id', live.user.id).eq('course_id', courseId)
      if (result.error) throw new Error('Bookmark removal failed')
    } else if (keys.length) {
      const rows = keys.map(key => {
        const courseId = byKey.get(key)
        if (!courseId) throw new Error('Course registry mismatch')
        return { user_id: live.user.id, course_id: courseId }
      })
      const result = await client.from('student_bookmarks').upsert(rows, {
        onConflict: 'user_id,course_id', ignoreDuplicates: true,
      })
      if (result.error) throw new Error('Bookmark insertion failed')
    }
    const saved = await loadBookmarks(client, live.user.id)
    if (input.action === 'merge'
      ? mergeApplied && input.courseIds.some(id => !saved.courseIds.includes(id))
      : input.action === 'remove' ? saved.courseKeys.includes(input.contentKey)
        : keys.some(key => !saved.courseKeys.includes(key))) return { status: 'unavailable' }
    return ready(live, saved.courseKeys)
  } catch { return { status: 'unavailable' } }
}
