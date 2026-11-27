import Link from 'next/link'
import { studentFocusControl } from '@/components/student/ui'
import { INACTIVE_SELECTION_COPY } from '@/components/student/selection-copy'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'

export const SELECTION_SUPPORT_HREF = `${STUDENT_DESTINATIONS.contact.href}#your-courses`

/** The way to correct a saved academic selection, beside the student's current details. */
export function SelectionChangeHelp({ inactive = false }: { inactive?: boolean }) {
  return <p className="max-w-prose text-sm text-student-text-secondary">
    {inactive ? INACTIVE_SELECTION_COPY.sentence : 'Picked the wrong department, level or semester?'}{' '}
    <Link href={SELECTION_SUPPORT_HREF} prefetch={false}
      className={`inline-flex min-h-11 items-center rounded-ci-btn underline underline-offset-2 ${studentFocusControl}`}>
      Contact us
    </Link>{" and we'll change it for you."}
  </p>
}
