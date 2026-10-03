// lib/managed-content/student-projection.ts — Validate published learning payloads for existing student views.
import { z } from 'zod'
import { parseContentPayload } from '@/lib/operator/editor-contract'
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
const cbtShape = z.object({ prompt: text, options: z.array(text),
  correctOption: z.number().int(), section: text.optional(), explanation: text.optional() })

export type ManagedOverview = z.infer<typeof overviewShape>
export type ManagedTheoryQuestion = { itemId: string; prompt: string; displayNumber?: number; examTip?: string }
export type ManagedQuizQuestion = {
  id: number
  questionId: string
  question: string
  options: string[]
  correctAnswer: number
  section: string
  explanation?: string
  publishedRevision: number
}
export type StudentLearning = {
  overview: ManagedOverview | null
  theoryQuestions: ManagedTheoryQuestion[]
  quizQuestions: ManagedQuizQuestion[]
}
export type StudentLearningResult =
  | { status: 'ok'; learning: StudentLearning }
  | { status: 'unavailable' }

/** Preserve only validated published revisions; missing families stay absent. */
export function projectStudentLearning(rows: ReadonlyArray<PublishedManagedContent>): StudentLearningResult {
  let overview: ManagedOverview | null = null
  const theoryQuestions: ManagedTheoryQuestion[] = []
  const quizQuestions: ManagedQuizQuestion[] = []
  const questionIds = new Set<string>()
  const theoryIds = new Set<string>()
  for (const row of rows) {
    if (parseContentPayload(row.kind, row.payload) === null) return { status: 'unavailable' }
    if (row.kind === 'course_overview') {
      const parsed = overviewShape.safeParse(row.payload)
      if (!parsed.success || overview !== null) return { status: 'unavailable' }
      overview = parsed.data
    } else if (row.kind === 'theory_question') {
      const parsed = theoryShape.safeParse(row.payload)
      if (!parsed.success || theoryIds.has(row.item_id)) return { status: 'unavailable' }
      theoryIds.add(row.item_id)
      const legacyNumber = /^theory:([1-9]\d*)$/.exec(row.source_key ?? '')
      const displayNumber = legacyNumber ? Number(legacyNumber[1]) : null
      theoryQuestions.push({ itemId: row.item_id, prompt: parsed.data.prompt,
        ...(displayNumber !== null && Number.isSafeInteger(displayNumber) ? { displayNumber } : {}),
        ...(parsed.data.examTip === undefined ? {} : { examTip: parsed.data.examTip }) })
    } else if (row.kind === 'cbt_question') {
      const parsed = cbtShape.safeParse(row.payload)
      if (!parsed.success || row.question_id === null || questionIds.has(row.question_id)) {
        return { status: 'unavailable' }
      }
      questionIds.add(row.question_id)
      quizQuestions.push({ id: quizQuestions.length + 1, questionId: row.question_id,
        question: parsed.data.prompt, options: parsed.data.options,
        correctAnswer: parsed.data.correctOption, section: parsed.data.section ?? 'General',
        ...(parsed.data.explanation === undefined ? {} : { explanation: parsed.data.explanation }),
        publishedRevision: row.revision })
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
  return { status: 'ok', learning: { overview, theoryQuestions, quizQuestions } }
}
