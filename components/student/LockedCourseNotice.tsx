// components/student/LockedCourseNotice.tsx — The one explanation of a course the student's plan does not include.
import Link from 'next/link'
import { LockKeyhole } from 'lucide-react'
import { courseChangeContact } from '@/lib/whatsapp'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from './Notice'
import { studentAction, studentFocusDark } from './ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement, ReactNode } from 'react'

/**
 * No content of the course is rendered beside this notice; the server never read it. `passOffered` is true only when
 * this student is eligible for a Discovery Pass (trialWording().passAvailable, which requires the server's eligibility
 * read); otherwise the pass is not mentioned at all, and no reason is given.
 */
export function LockedCourseNotice({ backHref, backLabel, passOffered = false, outsideList = false }: {
  backHref?: string; backLabel?: string; passOffered?: boolean; outsideList?: boolean
}): ReactElement {
  const back: ReactNode = backHref && backLabel
    ? <Link href={backHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{backLabel}</Link>
    : null
  if (outsideList) {
    const contact = courseChangeContact(STUDENT_DESTINATIONS.contact.href)
    return <div className="student-notice" data-tone="info" role="status" aria-atomic="true">
      <LockKeyhole aria-hidden="true" size={20} strokeWidth={1.75} />
      <div className="student-notice-body">
        <h2 className="student-notice-title">Not in your courses this semester.</h2>
        <p className="student-notice-text">Message us to add it.</p>
        <div className="student-notice-action">
          {contact.external
            ? <a href={contact.href} target="_blank" rel="noopener noreferrer"
              className={studentAction(btnNavy, studentFocusDark)}>Message us</a>
            : <Link href={contact.href} prefetch={false}
              className={studentAction(btnNavy, studentFocusDark)}>Message us</Link>}
          {back}
        </div>
      </div>
    </div>
  }
  return <Notice tone="info" title="Included with full access" action={<>
    <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      See how to unlock
    </Link>{back}
  </>}>
    Department courses open fully with Early Access.{passOffered && ' A free Discovery Pass lets you preview them first.'} GST
    courses stay free for every student.
  </Notice>
}
