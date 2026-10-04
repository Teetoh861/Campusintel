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
  | { status: 'signed-out' | 'invalid-course' | 'unavailable' }

export type PublishedCourseResult =
  | { status: 'ok'; courseId: string; content: PublishedManagedContent[] }
  | { status: 'signed-out' | 'invalid-course' | 'unavailable' }

async function readRows(client: AccountClient, courseId: string): Promise<PublishedContentResult> {
  const { data, error } = await client.rpc('read_published_managed_content', { p_course_id: courseId })
  if (error) return { status: 'unavailable' }
  const parsed = publishedRow.array().safeParse(data)
  if (!parsed.success || parsed.data.some(row => row.course_id !== courseId)) return { status: 'unavailable' }
  return { status: 'ok', content: parsed.data }
}

/** Read through the published-only RPC after a live student check on this exact
 * cookie-bound client. The RPC requires a live account session; invalid results
 * and read failures stay unavailable. Do not pass a service-role client here.
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
