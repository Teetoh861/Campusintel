// lib/operator/editor-contract.ts — Validated payloads, requests, and read models for the operator editor.
import { z } from 'zod'

export const contentKind = z.enum([
  'course_overview', 'note', 'cbt_question', 'theory_question', 'model_answer', 'rubric',
])
export type ContentKind = z.infer<typeof contentKind>

const uuid = z.string().uuid()
const requiredText = (limit: number) => z.string().max(limit).refine(value => value.trim().length > 0)
const optionalText = (limit: number) => requiredText(limit).optional()
const textContent = z.object({ title: requiredText(240), body: requiredText(200000) }).strict()
const cbtContent = z.object({
  prompt: requiredText(10000),
  options: z.array(requiredText(2000)).min(2).max(8),
  correctOption: z.number().int().min(0).max(7),
  section: optionalText(240),
  explanation: optionalText(10000),
}).strict().refine(value => value.correctOption < value.options.length)
const theoryContent = z.object({ prompt: requiredText(20000), examTip: optionalText(10000) }).strict()
const dependentContent = z.object({ body: requiredText(200000) }).strict()

const payloadSchemas = {
  course_overview: textContent,
  note: textContent,
  cbt_question: cbtContent,
  theory_question: theoryContent,
  model_answer: dependentContent,
  rubric: dependentContent,
}

/** Validate an editor payload against the same family contract enforced by SQL. */
export function parseContentPayload(kind: ContentKind, payload: unknown): Record<string, unknown> | null {
  const result = payloadSchemas[kind].safeParse(payload)
  return result.success ? result.data : null
}

export const editorMutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('provision'), institutionalCourseId: uuid }).strict(),
  z.object({ action: z.literal('create'), courseId: uuid, kind: contentKind,
    parentItemId: uuid.optional(), payload: z.unknown() }).strict(),
  z.object({ action: z.literal('revise'), itemId: uuid, expectedLockVersion: z.number().int().positive(),
    payload: z.unknown() }).strict(),
  z.object({ action: z.literal('review'), itemId: uuid, expectedLockVersion: z.number().int().positive(),
    revision: z.number().int().positive(), decision: z.enum(['approved', 'rejected']),
    note: z.string().max(2000).optional(), parentRevision: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal('publish'), itemId: uuid, expectedLockVersion: z.number().int().positive(),
    revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('unpublish'), itemId: uuid, expectedLockVersion: z.number().int().positive() }).strict(),
])
export type EditorMutation = z.infer<typeof editorMutation>
export type ContentMutation = Exclude<EditorMutation, { action: 'provision' }>

export const repositoryCourse = z.object({
  id: uuid, content_key: z.string().min(1), is_shared: z.boolean().nullable(),
}).strict()
export const institutionalCourse = z.object({
  id: uuid, course_code: z.string().min(1), display_title: z.string().min(1),
  repository_course_id: uuid.nullable(),
}).strict()
export type RepositoryCourse = z.infer<typeof repositoryCourse>
export type InstitutionalCourse = z.infer<typeof institutionalCourse>

export const managedItem = z.object({
  item_id: uuid, course_id: uuid, kind: contentKind, question_id: uuid.nullable(),
  source_key: z.string().nullable(), parent_item_id: uuid.nullable(),
  current_revision: z.number().int().positive(), approved_revision: z.number().int().positive().nullable(),
  published_revision: z.number().int().positive().nullable(),
  published_parent_revision: z.number().int().positive().nullable(),
  lock_version: z.number().int().positive(), payload: z.record(z.unknown()),
}).strict()
export type ManagedItem = z.infer<typeof managedItem>

export const managedHistory = z.object({
  item: z.object({
    id: uuid, course_id: uuid, kind: contentKind, question_id: uuid.nullable(),
    source_key: z.string().nullable(), parent_item_id: uuid.nullable(),
    current_revision: z.number().int().positive(), approved_revision: z.number().int().positive().nullable(),
    published_revision: z.number().int().positive().nullable(),
    published_parent_revision: z.number().int().positive().nullable(),
    lock_version: z.number().int().positive(), created_by: uuid,
    created_at: z.string(), updated_at: z.string(),
  }).strict(),
  revisions: z.array(z.object({ item_id: uuid, revision: z.number().int().positive(),
    schema_version: z.number().int().positive(), payload: z.record(z.unknown()),
    authored_by: uuid, authored_at: z.string() }).strict()),
  reviews: z.array(z.object({ item_id: uuid, revision: z.number().int().positive(),
    parent_revision: z.number().int().positive().nullable(), decision: z.enum(['approved', 'rejected']),
    note: z.string().nullable(), reviewed_by: uuid, reviewed_at: z.string(),
    lock_version: z.number().int().positive() }).strict()),
  publications: z.array(z.object({ item_id: uuid, lock_version: z.number().int().positive(),
    action: z.enum(['publish', 'unpublish']), revision: z.number().int().positive().nullable(),
    parent_revision: z.number().int().positive().nullable(), previous_revision: z.number().int().positive().nullable(),
    previous_parent_revision: z.number().int().positive().nullable(), acted_by: uuid,
    acted_at: z.string() }).strict()),
}).strict()
export type ManagedHistory = z.infer<typeof managedHistory>
