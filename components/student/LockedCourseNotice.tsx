// components/student/LockedCourseNotice.tsx — The one explanation of a course the student's plan does not include.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from './Notice'
import { studentAction, studentFocusDark } from './ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement, ReactNode } from 'react'

/** No content of the course is rendered beside this notice; the server never read it. */
export function LockedCourseNotice({ backHref, backLabel }: { backHref?: string; backLabel?: string }): ReactElement {
  const back: ReactNode = backHref && backLabel
    ? <Link href={backHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{backLabel}</Link>
    : null
  return <Notice tone="info" title="Included with full access" action={<>
    <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      See how to unlock
    </Link>{back}
  </>}>
    Department courses open with a 7-day free trial or Early Access. GST courses stay free for every student.
  </Notice>
}
