import 'server-only'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import { theoryFeedback } from './contract'
import { authoredRubricPoints } from './rubric'
import type { PublishedManagedContent } from '@/lib/managed-content/published'
import type { TheoryFeedback, TheoryQuestion } from './contract'

export type TheoryMaterial = { question: TheoryQuestion; feedback: TheoryFeedback | null }

/** Project only published RPC rows. The database owns the dependent theory-revision binding. */
export function projectTheoryPractice(rows: ReadonlyArray<PublishedManagedContent>): TheoryMaterial[] | null {
  const learning = projectStudentLearning(rows)
  if (learning.status !== 'ok') return null
  const materials: TheoryMaterial[] = []
  for (const item of learning.learning.theoryQuestions) {
    const source = rows.find(row => row.item_id === item.itemId && row.kind === 'theory_question')
    if (!source) return null
    const question = { ...item, publishedRevision: source.revision }
    const dependents = rows.filter(row => row.parent_item_id === item.itemId)
    const answers = dependents.filter(row => row.kind === 'model_answer')
    const rubrics = dependents.filter(row => row.kind === 'rubric')
    if (answers.length > 1 || rubrics.length > 1) return null
    if (answers.length === 0) { materials.push({ question, feedback: null }); continue }
    const answer = answers[0]!
    const rubric = rubrics[0]
    const body = rubric?.payload.body
    const parsed = theoryFeedback.safeParse({ question,
      modelAnswer: { itemId: answer.item_id, publishedRevision: answer.revision, body: answer.payload.body },
      rubric: rubric && typeof body === 'string'
        ? { itemId: rubric.item_id, publishedRevision: rubric.revision, body, points: authoredRubricPoints(body) }
        : null,
    })
    if (!parsed.success) return null
    materials.push({ question: parsed.data.question, feedback: parsed.data })
  }
  return materials
}
