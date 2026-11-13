// components/student/LockedCourseNotice.tsx — The one explanation of a course the student's plan does not include.
import Link from 'next/link'
import { LockKeyhole } from 'lucide-react'
import { courseAdditionContact, courseChangeContact } from '@/lib/whatsapp'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from './Notice'
import { STUDY_COPY, getStudyFamilyLabels } from './study-families'
import { profileSelectionHref } from '@/lib/profile/paths'
import type { CourseLockReason } from '@/lib/courses/read-model'
import type { BuildTimeStudy } from '@/lib/courses/build-time-study'
import { studentAction, studentFocusDark } from './ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { FREE_PASS_COPY, accessCopy } from '@/lib/entitlements/presentation'
import type { ReactElement, ReactNode } from 'react'

/**
 * No content of the course is rendered beside this notice; the server never read it. `passHours` is set only when
 * this student is eligible for a Discovery Pass (trialWording().passAvailable, which requires the server's eligibility
 * read); otherwise the pass is not mentioned at all, and no reason is given.
 */
export function LockedCourseNotice({ backHref, backLabel, passHours = null, outsideList = false, reason,
  plansOnSale = false, confirmReturnPath, has }: {
  backHref?: string; backLabel?: string; outsideList?: boolean; reason?: CourseLockReason
  /** What the course publishes, from build-time data (the database refuses to read it); it decides the offer. */
  has: BuildTimeStudy
  /** The pass length when this account can still start a free pass; null offers none. */
  passHours?: number | null
  /** The copy switch (plans_on_sale): "Subscribe" once plans are on sale. */
  plansOnSale?: boolean
  /** Where Confirm my courses returns to after a save (an allow-listed path), if not the home page. */
  confirmReturnPath?: string
}): ReactElement {
  const copy = accessCopy(plansOnSale)
  const back: ReactNode = backHref && backLabel
    ? <Link href={backHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>{backLabel}</Link>
    : null
  const confirm = reason === 'needs-selection'
  const selectionLocked = reason === 'selection-locked'
  if (outsideList || reason === 'outside-list' || confirm || selectionLocked) {
    const contact = selectionLocked ? courseChangeContact(STUDENT_DESTINATIONS.contact.href)
      : courseAdditionContact(STUDENT_DESTINATIONS.contact.href)
    return <div className="student-notice" data-tone="info" role="status" aria-atomic="true">
      <LockKeyhole aria-hidden="true" size={20} strokeWidth={1.75} />
      <div className="student-notice-body">
        <h2 className="student-notice-title">{confirm ? STUDY_COPY.confirmCourses
          : selectionLocked ? STUDY_COPY.selectionLocked : STUDY_COPY.outsideList}</h2>
        {!confirm && !selectionLocked && <p className="student-notice-text">Message us to add it.</p>}
        <div className="student-notice-action">
          {confirm ? <Link href={profileSelectionHref(confirmReturnPath)} prefetch={false}
            className={studentAction(btnNavy, studentFocusDark)}>Confirm my courses</Link> : contact.external
            ? <a href={contact.href} target="_blank" rel="noopener noreferrer"
              className={studentAction(btnNavy, studentFocusDark)}>Message us</a>
            : <Link href={contact.href} prefetch={false}
              className={studentAction(btnNavy, studentFocusDark)}>Message us</Link>}
          {!confirm && !selectionLocked && back}
        </div>
      </div>
    </div>
  }
  const families = getStudyFamilyLabels(has)
  // Nothing published: there is nothing to subscribe to, so the page says so and offers only the way back.
  if (families.length === 0) return <Notice tone="info" title={STUDY_COPY.notYetAvailable} action={back}>{null}</Notice>
  // One notice: what the course has, the unlock action and, when this account can start one, the free pass beside it;
  // what the pass includes is shown only where it is started.
  return <Notice tone="info" title={copy.lockedTitle} action={<>
    <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      {copy.lockedAction}
    </Link>
    {passHours !== null && <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false} data-pass-offer=""
      className={studentAction(btnGhost, 'bg-student-surface')}>{FREE_PASS_COPY.start}</Link>}
    {back}
  </>}>{families.join(' · ')}</Notice>
}
