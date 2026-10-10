// lib/operator/editor-client.ts — Typed browser transport for the guarded operator editor route.
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { institutionalCourse, managedHistory, managedItem, repositoryCourse } from './editor-contract'
import type { EditorMutation, InstitutionalCourse, ManagedHistory, ManagedItem, RepositoryCourse } from './editor-contract'
import type { ZodType } from 'zod'

const courses = z.object({ repositories: repositoryCourse.array(), institutional: institutionalCourse.array() }).strict()
const writeResult = z.object({ itemId: z.string().uuid().optional(), repositoryCourseId: z.string().uuid().optional(),
  created: z.boolean().optional(), lockVersion: z.number().int().positive().optional() }).strict()

export class EditorApiError extends Error {
  constructor(public status: number, message: string, public code?: 'session-changed') { super(message) }
}

async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  let body: unknown
  try { body = await response.json() }
  catch { throw new EditorApiError(503, 'The editor could not read the server response.') }
  if (!response.ok) {
    if (response.status === 409 && z.object({ status: z.literal('session-changed') }).safeParse(body).success) {
      throw new EditorApiError(409, 'Your account or session changed. Reload the workspace before continuing.', 'session-changed')
    }
    const problem = z.object({ message: z.string().optional() }).passthrough().safeParse(body)
    const fallback = response.status === 409 ? 'Another operator changed this record. Reload before continuing.'
      : response.status === 401 || response.status === 403 ? 'Operator access is no longer available.'
        : 'The content service is unavailable.'
    throw new EditorApiError(response.status, problem.success ? problem.data.message ?? fallback : fallback)
  }
  const envelope = z.object({ status: z.literal('ok'), data: z.unknown() }).strict().safeParse(body)
  const parsed = envelope.success ? schema.safeParse(envelope.data.data) : null
  if (!parsed?.success) throw new EditorApiError(503, 'The editor received an invalid server response.')
  return parsed.data
}

async function get<T>(query: URLSearchParams, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`/api/admin/editor?${query.toString()}`, { cache: 'no-store' })
  return parseResponse(response, schema)
}

/** Reload current repository and institutional course identities. */
export async function fetchOperatorCourses(): Promise<{
  repositories: RepositoryCourse[]; institutional: InstitutionalCourse[]
}> {
  return get(new URLSearchParams({ view: 'courses' }), courses)
}

/** Read current managed records for a repository course. */
export async function fetchOperatorItems(courseId: string): Promise<ManagedItem[]> {
  return get(new URLSearchParams({ view: 'items', courseId }), managedItem.array())
}

/** Read one managed item's immutable revisions, reviews, and publication events. */
export async function fetchOperatorHistory(itemId: string): Promise<ManagedHistory> {
  return get(new URLSearchParams({ view: 'history', itemId }), managedHistory)
}

/** Submit one deliberate editor action; the route revalidates Auth and input. */
export async function sendEditorMutation(input: EditorMutation, continuityToken: string): Promise<z.infer<typeof writeResult>> {
  const response = await fetch('/api/admin/editor', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: continuityToken },
    body: JSON.stringify(input), cache: 'no-store',
  })
  return parseResponse(response, writeResult)
}
