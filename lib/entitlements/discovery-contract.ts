// lib/entitlements/discovery-contract.ts — Discovery Pass previews as they may cross the client boundary.
// The database pins each preview and decides every limit, deadline and expiry (20261021100000_discovery_pass.sql); the
// CBT exam carries no answer key until the server has graded it. There is no theory preview.
import { z } from 'zod'
import { noteContent } from '@/lib/operator/editor-contract'

export const DISCOVERY_KINDS = ['cbt', 'study_guide'] as const
export const discoveryKind = z.enum(DISCOVERY_KINDS)
export type DiscoveryKind = z.infer<typeof discoveryKind>

/** URL segment of each preview page: /courses/[slug]/preview/[segment]. */
export const PREVIEW_SEGMENT: Record<DiscoveryKind, string> = { cbt: 'cbt', study_guide: 'study-guide' }

export function kindFromSegment(segment: string): DiscoveryKind | null {
  return DISCOVERY_KINDS.find(kind => PREVIEW_SEGMENT[kind] === segment) ?? null
}

// Mirrors the database bounds: at most 100 pinned questions of at most 8 options, and at most a million changes to
// one sheet from one tab.
const MAX_SAMPLE_QUESTIONS = 100
const MAX_OPTION_INDEX = 7
export const MAX_SAVE_REVISION = 1_000_000
const courseSlug = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const timestamp = z.string().min(1)
const uuid = z.string().uuid()

export const sampleAnswers = z.record(uuid, z.number().int().min(0).max(MAX_OPTION_INDEX))
  .refine(answers => Object.keys(answers).length <= MAX_SAMPLE_QUESTIONS)
export type SampleAnswers = z.infer<typeof sampleAnswers>
// The questions one tab changed since the sheet it last received from the database: a chosen option, or null for a
// choice cleared. Untouched questions are never sent, so another tab's answers to them can never be overwritten.
export const sheetChanges = z.record(uuid, z.number().int().min(0).max(MAX_OPTION_INDEX).nullable())
  .refine(changes => Object.keys(changes).length <= MAX_SAMPLE_QUESTIONS)
export type SheetChanges = z.infer<typeof sheetChanges>
// The database numbers the saved sheet (its revision) and each tab numbers its own changes (its sequence). A tab
// identifies itself so the database applies its requests in sequence order only: a request delayed on the network
// behind a newer one from the same tab is ignored, and a retry of an applied request is acknowledged, not reapplied.
const examTab = uuid
const changeSequence = z.number().int().min(0).max(MAX_SAVE_REVISION)
const savedRevision = z.number().int().min(0).max(MAX_SAVE_REVISION)

// What a save or submission carries about the tab's sheet. `baseRevision` is the database revision the tab's sheet is
// based on (its expected server revision); `changes` are its questions changed since then, at change `sequence`.
const sheetDelta = { tab: examTab, sequence: changeSequence, baseRevision: savedRevision, changes: sheetChanges }
export type SheetDelta = { tab: string; sequence: number; baseRevision: number; changes: SheetChanges }

export const discoveryCommandSchema = z.discriminatedUnion('action', [
  // The study guide names the topic the student chose; the exam names nothing else. Duration never comes from here.
  z.object({ action: z.literal('open'), courseSlug, kind: z.literal('cbt') }).strict(),
  z.object({ action: z.literal('open-topic'), courseSlug, itemId: uuid }).strict(),
  // Saved while the exam is open, so time running out marks what the student had chosen. Only the questions this tab
  // changed are sent; the database lays them over the sheet it holds and answers with the sheet that now stands.
  z.object({ action: z.literal('save-answers'), courseSlug, ...sheetDelta, sequence: changeSequence.min(1),
    changes: sheetChanges.refine(changes => Object.keys(changes).length > 0) }).strict(),
  // A fresh reading of the database clock and the deadline, with the sheet that stands. Changes nothing.
  z.object({ action: z.literal('sync-exam'), courseSlug, tab: examTab }).strict(),
  // Grades the sheet the database holds once this tab's pending changes (if any are still in time) are laid over it.
  z.object({ action: z.literal('submit-exam'), courseSlug, ...sheetDelta }).strict(),
])
export type DiscoveryCommand = z.infer<typeof discoveryCommandSchema>

// Titles only: a topic's body is never sent before the student opens it.
const topicTitle = z.object({ item_id: uuid, title: z.string() }).strict()
const sampleQuestion = z.object({ item_id: uuid, prompt: z.string(), options: z.array(z.string()).min(2).max(8),
  section: z.string() }).strict()
const sampleResult = z.object({
  score: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  // The exam closed at its deadline before it was submitted, and was marked from the answers saved in time.
  timed_out: z.boolean(),
  answers: z.array(z.object({ item_id: uuid, selected: z.number().int().nonnegative().nullable(),
    correct_option: z.number().int().nonnegative(), explanation: z.string().nullable() }).strict()),
}).strict()

// The sheet the database holds for an open exam and its revision, so a reload or another device continues from it.
const savedSheet = z.object({ revision: savedRevision, answers: sampleAnswers }).strict()

export const discoveryPreviewSchema = z.discriminatedUnion('kind', [
  // `saved` is null once the exam has been graded.
  z.object({ kind: z.literal('cbt'), deadline_at: timestamp,
    questions: z.array(sampleQuestion).min(1).max(MAX_SAMPLE_QUESTIONS), saved: savedSheet.nullable(),
    result: sampleResult.nullable() }).strict(),
  z.object({ kind: z.literal('study_guide'), items: z.array(z.object({ item_id: uuid, revision: z.number().int().positive(),
    note: noteContent }).strict()).length(1) }).strict(),
])
export type DiscoveryPreview = z.infer<typeof discoveryPreviewSchema>
export type SampleQuestion = z.infer<typeof sampleQuestion>
export type TopicTitle = z.infer<typeof topicTitle>
export type SampleResult = z.infer<typeof sampleResult>
export type SavedSheet = z.infer<typeof savedSheet>

const PLAIN_STATUSES = ['signed-out', 'session-changed', 'invalid-request', 'not-found', 'free-course', 'full-access',
  'no-pass', 'expired', 'nothing-to-preview', 'not-opened', 'unavailable'] as const

export const discoveryResultSchema = z.discriminatedUnion('status', [
  // `now` is the database clock at the time of the answer, for countdown display only.
  z.object({ status: z.literal('ready'), now: timestamp, endsAt: timestamp, preview: discoveryPreviewSchema }).strict(),
  z.object({ status: z.literal('available'), now: timestamp, endsAt: timestamp, topics: z.array(topicTitle).nullable() })
    .strict(),
  z.object({ status: z.literal('used-elsewhere'), endsAt: timestamp, courseCode: z.string().nullable(),
    courseSlug: z.string().nullable() }).strict(),
  // The exam runs for the course's whole duration or not at all: less than that is left on the pass.
  z.object({ status: z.literal('not-enough-time'), now: timestamp, endsAt: timestamp }).strict(),
  // The tab's changes up to the sequence it sent are in the database's sheet, which is returned at its revision with
  // the deadline, so the tab continues from the sheet that stands. A sync answers the same way without a change.
  z.object({ status: z.literal('saved'), now: timestamp, deadlineAt: timestamp, revision: savedRevision,
    answers: sampleAnswers }).strict(),
  // A request older than one this tab already had applied (delayed on the network behind it): nothing changed, and
  // the sheet that stands is returned so the tab continues from it.
  z.object({ status: z.literal('stale'), now: timestamp, deadlineAt: timestamp, revision: savedRevision,
    answers: sampleAnswers }).strict(),
  ...PLAIN_STATUSES.map(status => z.object({ status: z.literal(status) }).strict()),
])
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>
export type DiscoveryResultStatus = DiscoveryResult['status']
