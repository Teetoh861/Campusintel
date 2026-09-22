// Server-owned structure and completeness rules for student profile selections.
import 'server-only'
import { z } from 'zod'

const selectionSchema = z.object({
  departmentId: z.string().uuid(),
  academicLevelId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
}).strict()

const storedSelectionSchema = z.object({
  department_id: z.string().uuid().nullable(),
  academic_level_id: z.string().uuid().nullable(),
  academic_period_id: z.string().uuid().nullable(),
}).strict()

export type SelectionIds = z.infer<typeof selectionSchema>

/** Accept exactly three reference IDs; identity and provider fields are never input. */
export function parseSubmittedSelection(input: unknown): SelectionIds | null {
  const result = selectionSchema.safeParse(input)
  return result.success ? result.data : null
}

/** Classify the database's all-null or all-complete selection invariant in one place. */
export function classifyStoredSelection(input: unknown):
  | { kind: 'incomplete' }
  | { kind: 'complete'; ids: SelectionIds }
  | { kind: 'invariant-failure' } {
  const result = storedSelectionSchema.safeParse(input)
  if (!result.success) return { kind: 'invariant-failure' }
  const { department_id, academic_level_id, academic_period_id } = result.data
  if (department_id === null && academic_level_id === null && academic_period_id === null) {
    return { kind: 'incomplete' }
  }
  if (department_id === null || academic_level_id === null || academic_period_id === null) {
    return { kind: 'invariant-failure' }
  }
  return { kind: 'complete', ids: {
    departmentId: department_id,
    academicLevelId: academic_level_id,
    academicPeriodId: academic_period_id,
  } }
}
