// lib/managed-content/published.ts — Server read boundary for published repository-course content.
import 'server-only'
import { z } from 'zod'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import type { NextResponse } from 'next/server'

type AccountClient = Awaited<ReturnType<typeof createClient>>
const contentKey = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const repositoryRow = z.object({ id: z.string().uuid(), content_key: contentKey }).strict()

const publishedRow = z.object({
  item_id: z.string().uuid(),
  course_id: z.string().uuid(),
  kind: z.enum(['course_overview', 'note', 'cbt_question', 'theory_question', 'model_answer', 'rubric']),
  question_id: z.string().uuid().nullable(),
  source_key: z.string().nullable(),
  parent_item_id: z.string().uuid().nullable(),
  revision: z.number().int().positive(),
  payload: z.record(z.unknown()),
}).strict()

export type PublishedManagedContent = z.infer<typeof publishedRow>
export type PublishedContentResult =
  | { status: 'ok'; content: PublishedManagedContent[] }
  | { status: 'signed-out' | 'invalid-course' | 'locked' | 'unavailable' }

export type PublishedCourseResult =
  | { status: 'ok'; courseId: string; content: PublishedManagedContent[] }
  | { status: 'signed-out' | 'invalid-course' | 'locked' | 'unavailable' }

// private.require_live_account() raises this code when the cookie-bound session is no longer live.
const LIVE_SESSION_REQUIRED_CODE = '42501'
// The read raises this for a non-free course when the student has no active entitlement grant.
const COURSE_LOCKED_CODE = 'CI403'

async function readRows(client: AccountClient, courseId: string): Promise<PublishedContentResult> {
  const { data, error } = await client.rpc('read_published_managed_content', { p_course_id: courseId })
  if (error) {
    return { status: error.code === LIVE_SESSION_REQUIRED_CODE ? 'signed-out'
      : error.code === COURSE_LOCKED_CODE ? 'locked' : 'unavailable' }
  }
  const parsed = publishedRow.array().safeParse(data)
  if (!parsed.success || parsed.data.some(row => row.course_id !== courseId)) return { status: 'unavailable' }
  return { status: 'ok', content: parsed.data }
}

/** Read through the published-only RPC after a live student check on this exact
 * cookie-bound client. The RPC requires a live account session: its 42501 refusal
 * is signed-out, its CI403 entitlement refusal is locked, and invalid results and
 * other read failures stay unavailable.
 * Do not pass a service-role client here.
 */
export async function getPublishedManagedContentWithVerifiedClient(
  client: AccountClient, courseId: string,
): Promise<PublishedContentResult> {
  if (!z.string().uuid().safeParse(courseId).success) return { status: 'invalid-course' }
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try { return await readRows(client, courseId) }
  catch { return { status: 'unavailable' } }
}

/** Validate the live account before reading the database's published-only projection. */
export async function getPublishedManagedContent(
  courseId: string, response?: NextResponse,
): Promise<PublishedContentResult> {
  if (!z.string().uuid().safeParse(courseId).success) return { status: 'invalid-course' }
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const user = await getStudentSessionUser(response, client)
    if (user === null) return { status: 'signed-out' }
    return await getPublishedManagedContentWithVerifiedClient(client, courseId)
  } catch {
    return { status: 'unavailable' }
  }
}

/** Resolve a repository content key through public.courses before the published read. */
export async function getPublishedManagedCourse(
  key: string, response?: NextResponse,
): Promise<PublishedCourseResult> {
  if (!contentKey.safeParse(key).success) return { status: 'invalid-course' }
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const user = await getStudentSessionUser(response, client)
    if (user === null) return { status: 'signed-out' }
    const bridge = await client.from('courses').select('id,content_key')
      .eq('content_key', key).maybeSingle()
    if (bridge.error) return { status: 'unavailable' }
    const row = repositoryRow.safeParse(bridge.data)
    if (!row.success || row.data.content_key !== key) return { status: 'unavailable' }
    const published = await readRows(client, row.data.id)
    return published.status === 'ok'
      ? { status: 'ok', courseId: row.data.id, content: published.content }
      : published
  } catch {
    return { status: 'unavailable' }
  }
}

const bankSizeRow = z.object({ course_id: z.string().uuid(), bank_size: z.number().int().nonnegative() }).strict()
const SUMMARY_MAX_COURSES = 200

/** One course's practice bank size, or why it could not be read. */
export type CbtBankSize = number | 'locked' | 'unavailable'
export type CbtBankSizesResult = { status: 'ok'; sizes: Map<string, CbtBankSize> } | { status: 'signed-out' }

async function readBankSizes(client: AccountClient, courseIds: ReadonlyArray<string>):
  Promise<{ status: 'ok'; sizes: Map<string, number> } | { status: 'signed-out' | 'locked' | 'unavailable' }> {
  const { data, error } = await client.rpc('published_cbt_summary', { p_course_ids: [...courseIds] })
  if (error) {
    return { status: error.code === LIVE_SESSION_REQUIRED_CODE ? 'signed-out'
      : error.code === COURSE_LOCKED_CODE ? 'locked' : 'unavailable' }
  }
  const parsed = bankSizeRow.array().safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }
  const sizes = new Map(parsed.data.map(row => [row.course_id, row.bank_size]))
  return courseIds.every(id => sizes.has(id)) ? { status: 'ok', sizes } : { status: 'unavailable' }
}

/** Practice bank sizes for the listed readable courses, in one read through the count-only summary
 * (published_cbt_summary): never a question. The summary refuses the whole list (CI403) when any course is no longer
 * readable, so a plan that ends mid-request falls back to one read per course and marks only those courses locked.
 * Do not pass a service-role client here.
 */
export async function getPublishedCbtBankSizesWithVerifiedClient(
  client: AccountClient, courseIds: ReadonlyArray<string>,
): Promise<CbtBankSizesResult> {
  const ids = [...new Set(courseIds)]
  const sizes = new Map<string, CbtBankSize>()
  if (ids.length === 0) return { status: 'ok', sizes }
  if (!isStudentAuthEnabled() || ids.length > SUMMARY_MAX_COURSES || ids.some(id => !z.string().uuid().safeParse(id).success)) {
    for (const id of ids) sizes.set(id, 'unavailable')
    return { status: 'ok', sizes }
  }
  try {
    const all = await readBankSizes(client, ids)
    if (all.status === 'signed-out') return { status: 'signed-out' }
    if (all.status === 'ok') return { status: 'ok', sizes: new Map(all.sizes) }
    if (all.status === 'unavailable' || ids.length === 1) {
      for (const id of ids) sizes.set(id, all.status)
      return { status: 'ok', sizes }
    }
    const each = await Promise.all(ids.map(id => readBankSizes(client, [id])))
    for (const [index, one] of each.entries()) {
      if (one.status === 'signed-out') return { status: 'signed-out' }
      sizes.set(ids[index]!, one.status === 'ok' ? one.sizes.get(ids[index]!)! : one.status)
    }
    return { status: 'ok', sizes }
  } catch {
    for (const id of ids) sizes.set(id, 'unavailable')
    return { status: 'ok', sizes }
  }
}
