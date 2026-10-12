// components/student/study-families.ts — Product order, names and availability copy of the Student App study families.
import type { StudyAvailability } from '@/lib/courses/read-model'

/** Locked product order: Notes, CBT practice, Theory. Every surface lists families in this order. */
export const STUDY_FAMILIES = [
  { id: 'notes', label: 'Notes' },
  { id: 'cbtPractice', label: 'CBT practice' },
  { id: 'theory', label: 'Theory' },
] as const

export type StudyFamilyId = (typeof STUDY_FAMILIES)[number]['id']

/** Labels of the families a course can be studied through, in product order. */
export function getStudyFamilyLabels(study: Pick<StudyAvailability, StudyFamilyId>): string[] {
  return STUDY_FAMILIES.filter(family => study[family.id]).map(family => family.label)
}

/** Exact availability copy shared by every course presentation. */
export const STUDY_COPY = {
  notYetAvailable: 'Study content not yet available.',
  temporarilyUnavailable: 'Content temporarily unavailable.',
} as const
