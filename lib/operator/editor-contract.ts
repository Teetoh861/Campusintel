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
const studyText = requiredText(10000)
export const courseOverviewContent = textContent.extend({
  topics: z.array(z.object({ chapter: studyText, description: studyText }).strict()).max(200).optional(),
  examFocus: z.array(studyText).max(200).optional(),
  keyTakeaways: z.array(z.object({ title: studyText, description: studyText }).strict()).max(200).optional(),
  formulaSheet: z.array(z.object({ name: studyText, formula: studyText,
    explanation: studyText, example: studyText.optional() }).strict()).max(200).optional(),
}).strict()
const topicNoteContent = textContent.extend({ noteType: z.literal('topic_note'),
  keyPoints: z.array(studyText).min(1).max(200), examTip: studyText.optional() }).strict()
const calculatorTrickContent = textContent.extend({ noteType: z.literal('calculator_trick'),
  example: studyText, formula: studyText.optional() }).strict()
export const noteContent = z.union([textContent, topicNoteContent, calculatorTrickContent])
export type CourseOverviewPayload = z.infer<typeof courseOverviewContent>
export type NotePayload = z.infer<typeof noteContent>
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
  course_overview: courseOverviewContent,
  note: noteContent,
  cbt_question: cbtContent,
  theory_question: theoryContent,
  model_answer: dependentContent,
  rubric: dependentContent,
}
// Must match private.assert_managed_payload's octet_length(p_payload::text) limit.
const MAX_MANAGED_PAYLOAD_BYTES = 262144

function jsonbFormattingSpaces(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(0, value.length - 1) + value.reduce<number>((total, entry) =>
      total + jsonbFormattingSpaces(entry), 0)
  }
  if (value === null || typeof value !== 'object') return 0
  const entries: unknown[] = Object.values(value).filter(entry => entry !== undefined)
  return Math.max(0, entries.length * 2 - 1) + entries.reduce<number>((total, entry) =>
    total + jsonbFormattingSpaces(entry), 0)
}

function managedPayloadBytes(payload: Record<string, unknown>): number {
  // jsonb::text adds one space after each comma and colon in compact JSON.
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength + jsonbFormattingSpaces(payload)
}

/** Validate an editor payload against the same family contract enforced by SQL. */
export function parseContentPayload(kind: ContentKind, payload: unknown): Record<string, unknown> | null {
  const result = payloadSchemas[kind].safeParse(payload)
  return result.success && managedPayloadBytes(result.data) <= MAX_MANAGED_PAYLOAD_BYTES ? result.data : null
}

/** Describe the first failure from the same payload schema used for editor writes. */
export function contentPayloadProblem(kind: ContentKind, payload: unknown): string | null {
  const subtype = kind === 'note' && typeof payload === 'object' && payload !== null && 'noteType' in payload
    ? payload.noteType : null
  const schema = subtype === 'topic_note' ? topicNoteContent
    : subtype === 'calculator_trick' ? calculatorTrickContent : payloadSchemas[kind]
  const result = schema.safeParse(payload)
  if (result.success) {
    return managedPayloadBytes(result.data) > MAX_MANAGED_PAYLOAD_BYTES
      ? 'Content exceeds the 262,144-byte limit. Shorten or remove some fields before saving.' : null
  }
  const issue = result.error.issues[0]
  if (!issue) return 'Check the content fields.'
  const path = issue.path.map(part => typeof part === 'number' ? `entry ${part + 1}` : part).join(' / ')
  const reason = issue.message === 'Invalid input' ? 'enter a non-empty value.' : issue.message
  return `Check ${path || 'the content'}: ${reason}`
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
