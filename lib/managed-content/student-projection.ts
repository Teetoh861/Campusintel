// lib/managed-content/student-projection.ts — Validate published learning payloads for existing student views.
import { z } from 'zod'
import { noteContent, parseContentPayload } from '@/lib/operator/editor-contract'
import type { NotePayload } from '@/lib/operator/editor-contract'
import type { PublishedManagedContent } from './published'

const text = z.string()
const overviewShape = z.object({
  title: text, body: text,
  topics: z.array(z.object({ chapter: text, description: text })).optional(),
  examFocus: z.array(text).optional(),
  keyTakeaways: z.array(z.object({ title: text, description: text })).optional(),
  formulaSheet: z.array(z.object({ name: text, formula: text,
    explanation: text, example: text.optional() })).optional(),
})
const theoryShape = z.object({ prompt: text, examTip: text.optional() })

export type ManagedOverview = z.infer<typeof overviewShape>
export type ManagedTheoryQuestion = { itemId: string; prompt: string; displayNumber?: number; examTip?: string }
/** A published note keeps the exact editor-contract payload beside its managed identity. */
export type ManagedNote = { itemId: string; publishedRevision: number } & NotePayload
// CBT questions are not student learning content: they reach a student only inside their own server-run practice
// attempt (20261025100000_server_run_practice.sql), and the published read never returns them.
export type StudentLearning = {
  overview: ManagedOverview | null
  notes: ManagedNote[]
  theoryQuestions: ManagedTheoryQuestion[]
}
export type StudentLearningResult =
  | { status: 'ok'; learning: StudentLearning }
  | { status: 'unavailable' }

/** Preserve only validated published revisions; missing families stay absent. */
export function projectStudentLearning(rows: ReadonlyArray<PublishedManagedContent>): StudentLearningResult {
  let overview: ManagedOverview | null = null
  const notes: ManagedNote[] = []
  const theoryQuestions: ManagedTheoryQuestion[] = []
  const noteIds = new Set<string>()
  const theoryIds = new Set<string>()
  for (const row of rows) {
    // A CBT row is never projected for a student, whatever reaches this boundary.
    if (row.kind === 'cbt_question') continue
    if (parseContentPayload(row.kind, row.payload) === null) return { status: 'unavailable' }
    if (row.kind === 'course_overview') {
      const parsed = overviewShape.safeParse(row.payload)
      if (!parsed.success || overview !== null) return { status: 'unavailable' }
      overview = parsed.data
    } else if (row.kind === 'note') {
      // The editor contract is the single note validator; its parsed payload is kept verbatim.
      const parsed = noteContent.safeParse(row.payload)
      if (!parsed.success || noteIds.has(row.item_id)) return { status: 'unavailable' }
      noteIds.add(row.item_id)
      notes.push({ itemId: row.item_id, publishedRevision: row.revision, ...parsed.data })
    } else if (row.kind === 'theory_question') {
      const parsed = theoryShape.safeParse(row.payload)
      if (!parsed.success || theoryIds.has(row.item_id)) return { status: 'unavailable' }
      theoryIds.add(row.item_id)
      const legacyNumber = /^theory:([1-9]\d*)$/.exec(row.source_key ?? '')
      const displayNumber = legacyNumber ? Number(legacyNumber[1]) : null
      theoryQuestions.push({ itemId: row.item_id, prompt: parsed.data.prompt,
        ...(displayNumber !== null && Number.isSafeInteger(displayNumber) ? { displayNumber } : {}),
        ...(parsed.data.examTip === undefined ? {} : { examTip: parsed.data.examTip }) })
    }
  }
  for (const row of rows) {
    if ((row.kind === 'model_answer' || row.kind === 'rubric') &&
        (row.parent_item_id === null || !theoryIds.has(row.parent_item_id))) {
      return { status: 'unavailable' }
    }
  }
  theoryQuestions.sort((a, b) => (a.displayNumber ?? Number.MAX_SAFE_INTEGER) -
    (b.displayNumber ?? Number.MAX_SAFE_INTEGER))
  return { status: 'ok', learning: { overview, notes, theoryQuestions } }
}
