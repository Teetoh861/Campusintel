// components/student/study-families.ts — Product order, names and availability copy of the Student App study families.
import type { StudyAvailability } from '@/lib/courses/read-model'

/** Locked product order: Notes, Practice, Theory. Every surface lists families in this order. */
export const STUDY_FAMILIES = [
  { id: 'notes', label: 'Notes' },
  { id: 'cbtPractice', label: 'Practice' },
  { id: 'theory', label: 'Theory' },
] as const

export type StudyFamilyId = (typeof STUDY_FAMILIES)[number]['id']

/** Labels of the families a course can be studied through, in product order. */
export function getStudyFamilyLabels(study: Pick<StudyAvailability, StudyFamilyId>): string[] {
  return STUDY_FAMILIES.filter(family => study[family.id]).map(family => family.label)
}

/** Exact availability copy shared by every course presentation. */
export const STUDY_COPY = {
  rowNoMaterials: 'No study materials yet',
  notYetAvailable: 'Study materials are not available.',
  temporarilyUnavailable: 'Study materials are temporarily unavailable.',
  locked: 'Included with a plan.',
  outsideList: 'Not in your courses this semester.',
  confirmCourses: 'Confirm your courses for this semester.',
  selectionLocked: 'Not in your courses this semester.',
} as const
