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
import { FreeMonthStart } from '@/app/access/FreeMonthOffer'
import { FREE_MONTH_COPY, FREE_PASS_COPY, accessCopy } from '@/lib/entitlements/presentation'
import type { FreeMonthClaim } from '@/app/access/FreeMonthOffer'
import type { ReactElement, ReactNode } from 'react'

/**
 * No content of the course is rendered beside this notice; the server never read it. `passHours` is set only when
 * this student is eligible for a Discovery Pass (trialWording().passAvailable, which requires the server's eligibility
 * read); otherwise the pass is not mentioned at all, and no reason is given. `freeMonth` is set only when the database
 * says this student can claim free access now; the button then opens its confirmation here.
 */
export function LockedCourseNotice({ backHref, backLabel, passHours = null, outsideList = false, reason,
  plansOnSale = false, confirmReturnPath, has, freeMonth = null }: {
  backHref?: string; backLabel?: string; outsideList?: boolean; reason?: CourseLockReason
  /** What the course publishes, from build-time data (the database refuses to read it); it decides the offer. */
  has: BuildTimeStudy
  /** The pass length when this account can still start a free pass; null offers none. */
  passHours?: number | null
  /** The copy switch (plans_on_sale): "Subscribe" once plans are on sale. */
  plansOnSale?: boolean
  /** Where Confirm your courses returns to after a save (an allow-listed path), if not the home page. */
  confirmReturnPath?: string
  /** What the free access claim needs, when this student can claim it now; null offers none. */
  freeMonth?: FreeMonthClaim | null
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
    // The button says what the message is for, so no line is needed above it.
    const message = selectionLocked ? 'Message us' : 'Message us to add it'
    return <div className="student-notice" data-tone="info" role="status" aria-atomic="true">
      <LockKeyhole aria-hidden="true" size={20} strokeWidth={1.75} />
      <div className="student-notice-body">
        <h2 className="student-notice-title">{confirm ? STUDY_COPY.confirmCourses
          : selectionLocked ? STUDY_COPY.selectionLocked : STUDY_COPY.outsideList}</h2>
        <div className="student-notice-action">
          {confirm ? <Link href={profileSelectionHref(confirmReturnPath)} prefetch={false}
            className={studentAction(btnNavy, studentFocusDark)}>Confirm your courses</Link> : contact.external
            ? <a href={contact.href} target="_blank" rel="noopener noreferrer"
              className={studentAction(btnNavy, studentFocusDark)}>{message}</a>
            : <Link href={contact.href} prefetch={false}
              className={studentAction(btnNavy, studentFocusDark)}>{message}</Link>}
          {!confirm && !selectionLocked && back}
        </div>
      </div>
    </div>
  }
  const families = getStudyFamilyLabels(has)
  // Nothing published: there is nothing to subscribe to, so the page says so and offers only the way back.
  if (families.length === 0) return <Notice tone="info" title={STUDY_COPY.notYetAvailable} action={back}>{null}</Notice>
  // Free access, when this student can claim it now: its confirmation opens here, and the course opens with it.
  if (freeMonth !== null) return <Notice tone="info" title={FREE_MONTH_COPY.lockedTitle(freeMonth.endsOn)} action={<>
    <FreeMonthStart {...freeMonth} />
    {back}
  </>}>{families.join(' · ')}</Notice>
  // One notice with one button to Plan & Access, named for what this account finds there: the free pass when it can
  // still start one, otherwise the way to unlock. What the pass includes is shown only where it is started.
  return <Notice tone="info" title={copy.lockedTitle} action={<>
    <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      {passHours !== null ? FREE_PASS_COPY.start : copy.lockedAction}
    </Link>
    {back}
  </>}>{families.join(' · ')}</Notice>
}
