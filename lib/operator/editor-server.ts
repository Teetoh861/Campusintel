// lib/operator/editor-server.ts — Server-owned reads and mutations for the operator content workspace.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { contentPayloadProblem, institutionalCourse, managedHistory, managedItem, parseContentPayload, repositoryCourse } from './editor-contract'
import type { OperatorAccess } from './access'
import type { EditorMutation, InstitutionalCourse, ManagedHistory, ManagedItem, RepositoryCourse } from './editor-contract'

type OperatorClient = Extract<OperatorAccess, { status: 'operator' }>['client']
export type EditorResult<T> = { status: 'ok'; data: T } | {
  status: 'invalid' | 'conflict' | 'forbidden' | 'unavailable'
  message: string
}

function databaseFailure(error: { code?: string } | null): EditorResult<never> {
  if (error?.code === '40001') return { status: 'conflict', message: 'Another operator changed this record. Reload the latest version before continuing.' }
  if (error?.code === '42501') return { status: 'forbidden', message: 'Your account no longer has operator access.' }
  if (['22023', '23503', '23505'].includes(error?.code ?? '')) {
    return { status: 'invalid', message: error?.code === '23505'
      ? 'This content already exists. Reload the course and edit the existing record.'
      : 'The content or workflow action is invalid. Review the fields and current status.' }
  }
  return { status: 'unavailable', message: 'The content database is unavailable. Try again later.' }
}

/** Discover repository identities and the full institutional catalogue for an authorized operator. */
export async function readOperatorCourses(client: OperatorClient): Promise<EditorResult<{
  repositories: RepositoryCourse[]; institutional: InstitutionalCourse[]
}>> {
  try {
    const [repositories, institutional] = await Promise.all([
      client.from('courses').select('id,content_key,is_shared').order('content_key'),
      client.from('institutional_courses').select('id,course_code,display_title,repository_course_id')
        .order('course_code').order('display_title'),
    ])
    if (repositories.error || institutional.error) return databaseFailure(repositories.error ?? institutional.error)
    const parsedRepositories = repositoryCourse.array().safeParse(repositories.data)
    const parsedInstitutional = institutionalCourse.array().safeParse(institutional.data)
    if (!parsedRepositories.success || !parsedInstitutional.success) return databaseFailure(null)
    const ids = new Set(parsedRepositories.data.map(course => course.id))
    if (parsedInstitutional.data.some(course => course.repository_course_id && !ids.has(course.repository_course_id))) {
      return databaseFailure(null)
    }
    return { status: 'ok', data: { repositories: parsedRepositories.data, institutional: parsedInstitutional.data } }
  } catch { return databaseFailure(null) }
}

/** List current operator drafts and publication pointers for one repository course. */
export async function readOperatorItems(client: OperatorClient, courseId: string): Promise<EditorResult<ManagedItem[]>> {
  try {
    const { data, error } = await client.rpc('list_managed_content', { p_course_id: courseId })
    if (error) return databaseFailure(error)
    const parsed = managedItem.array().safeParse(data)
    if (!parsed.success || parsed.data.some(item => item.course_id !== courseId)) return databaseFailure(null)
    return { status: 'ok', data: parsed.data }
  } catch { return databaseFailure(null) }
}

/** Read immutable revisions, reviews, and publication events for one operator-selected item. */
export async function readOperatorHistory(client: OperatorClient, itemId: string): Promise<EditorResult<ManagedHistory>> {
  try {
    const { data, error } = await client.rpc('get_managed_content_history', { p_item_id: itemId })
    if (error) return databaseFailure(error)
    const parsed = managedHistory.safeParse(data)
    if (!parsed.success || parsed.data.item.id !== itemId) return databaseFailure(null)
    return { status: 'ok', data: parsed.data }
  } catch { return databaseFailure(null) }
}

/** Execute a validated editor action through the existing live-operator RPC boundary. */
export async function writeOperatorContent(client: OperatorClient, input: EditorMutation): Promise<EditorResult<{
  itemId?: string; repositoryCourseId?: string; created?: boolean; lockVersion?: number
}>> {
  try {
    if (input.action === 'provision') {
      const { data, error } = await client.rpc('provision_repository_content', {
        p_institutional_course_id: input.institutionalCourseId,
      })
      if (error) return databaseFailure(error)
      const parsed = z.array(z.object({ repository_course_id: z.string().uuid(), created: z.boolean() }).strict())
        .length(1).safeParse(data)
      if (!parsed.success) return databaseFailure(null)
      return { status: 'ok', data: { repositoryCourseId: parsed.data[0].repository_course_id,
        created: parsed.data[0].created } }
    }
    if (input.action === 'create') {
      const payload = parseContentPayload(input.kind, input.payload)
      if (!payload) return { status: 'invalid', message: contentPayloadProblem(input.kind, input.payload)
        ?? 'Complete all required fields.' }
      if ((input.kind === 'model_answer' || input.kind === 'rubric') !== Boolean(input.parentItemId)) {
        return { status: 'invalid', message: 'Complete all required fields and select a theory question where needed.' }
      }
      const { data, error } = await client.rpc('create_managed_content', {
        p_course_id: input.courseId, p_kind: input.kind, p_payload: payload,
        p_question_id: input.kind === 'cbt_question' ? randomUUID() : null,
        p_source_key: null, p_parent_item_id: input.parentItemId ?? null,
      })
      if (error) return databaseFailure(error)
      const parsed = z.string().uuid().safeParse(data)
      return parsed.success ? { status: 'ok', data: { itemId: parsed.data } } : databaseFailure(null)
    }
    if (input.action === 'revise') {
      const history = await readOperatorHistory(client, input.itemId)
      if (history.status !== 'ok') return history
      const payload = parseContentPayload(history.data.item.kind, input.payload)
      if (!payload) return { status: 'invalid', message: contentPayloadProblem(history.data.item.kind, input.payload)
        ?? 'The content fields are incomplete or invalid.' }
      const { data, error } = await client.rpc('revise_managed_content', {
        p_item_id: input.itemId, p_expected_lock_version: input.expectedLockVersion, p_payload: payload,
      })
      if (error) return databaseFailure(error)
      const parsed = z.number().int().positive().safeParse(data)
      return parsed.success ? { status: 'ok', data: { lockVersion: parsed.data } } : databaseFailure(null)
    }
    const args = { p_item_id: input.itemId, p_expected_lock_version: input.expectedLockVersion }
    const result = input.action === 'review'
      ? await client.rpc('review_managed_content', { ...args, p_revision: input.revision,
        p_decision: input.decision, p_note: input.note ?? null, p_parent_revision: input.parentRevision ?? null })
      : input.action === 'publish'
        ? await client.rpc('publish_managed_content', { ...args, p_revision: input.revision })
        : await client.rpc('unpublish_managed_content', args)
    if (result.error) return databaseFailure(result.error)
    const parsed = z.number().int().positive().safeParse(result.data)
    return parsed.success ? { status: 'ok', data: { lockVersion: parsed.data } } : databaseFailure(null)
  } catch { return databaseFailure(null) }
}
