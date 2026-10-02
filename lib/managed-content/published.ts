// lib/managed-content/published.ts — Server read boundary for published repository-course content.
import 'server-only'
import { z } from 'zod'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import type { NextResponse } from 'next/server'

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
    const { data, error } = await client.rpc('read_published_managed_content', { p_course_id: courseId })
    if (error) return { status: 'unavailable' }
    const parsed = publishedRow.array().safeParse(data)
    if (!parsed.success || parsed.data.some(row => row.course_id !== courseId)) return { status: 'unavailable' }
    return { status: 'ok', content: parsed.data }
  } catch {
    return { status: 'unavailable' }
  }
}
