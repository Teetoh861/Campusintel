// components/student/ui.ts — Student App focus families and compact action composition.
import { btnBase, btnSm, buttonClassName } from '@/components/chrome/ui'

export const studentFocusControl = 'student-focus-control'
export const studentFocusRow = 'student-focus-row'
export const studentFocusDark = 'student-focus-dark'
export const studentFocusCard = 'student-focus-card'

/** Use existing action semantics with the Student App's contained focus treatment. */
export function studentAction(...parts: Array<string | false | null | undefined>): string {
  return buttonClassName(btnBase, btnSm, studentFocusControl, ...parts)
}
