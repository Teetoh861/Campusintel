// components/dashboard/SupportingActions.tsx — Material destinations and quieter help/account rows.
import Link from 'next/link'
import { ArrowRight, LifeBuoy, UserRound, UsersRound } from 'lucide-react'
import { StatusRail } from '@/components/student/StatusRail'
import { studentFocusCard, studentFocusRow } from '@/components/student/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement } from 'react'

/** Keep material requests distinct from AI practice and utilities below the primary cards. */
export function SupportingActions(): ReactElement {
  const destinations = STUDENT_DESTINATIONS
  return <>
    <section aria-labelledby="material-title" className="dashboard-section student-enter student-enter-3">
      <h2 id="material-title" className="dashboard-section-heading">Courses and material</h2>
      <div className="dashboard-material-grid">
        <Link href={destinations.bookmarks.href} prefetch={false}
          className={`dashboard-material-card dashboard-bookmark-card student-interactive-card ${studentFocusCard}`}>
          <h3>{destinations.bookmarks.label}</h3><p>Return to your bookmarked courses.</p>
          <span className="dashboard-action-label">Open bookmarks <ArrowRight aria-hidden="true" size={17} /></span>
        </Link>
        <Link href={destinations.courses.href} className={`dashboard-material-card student-interactive-card ${studentFocusCard}`}>
          <h3>{destinations.courses.label}</h3><p>Explore the course library.</p>
          <span className="dashboard-action-label">Browse the library <ArrowRight aria-hidden="true" size={17} /></span>
        </Link>
        <Link href={destinations.materials.href} className={`dashboard-material-card dashboard-request-card student-interactive-card ${studentFocusCard}`}>
          <h3>{destinations.materials.label}</h3><p>Missing a course resource? Let us know.</p>
          <span className="dashboard-action-label">Request course material <ArrowRight aria-hidden="true" size={17} /></span>
        </Link>
      </div>
    </section>
    <section aria-labelledby="utilities-title" className="dashboard-section student-enter student-enter-4">
      <h2 id="utilities-title" className="dashboard-section-heading">Help and account</h2>
      <div className="dashboard-utility-group">
        <Link href={destinations.tutors.href} className={`dashboard-utility-row ${studentFocusRow}`}>
          <UsersRound aria-hidden="true" size={20} className="dashboard-utility-icon" />
          <div><h3>{destinations.tutors.label} <StatusRail status="waitlist">Waitlist</StatusRail></h3><p>Join the tutoring waitlist.</p></div>
          <ArrowRight aria-hidden="true" size={18} className="dashboard-utility-arrow" />
        </Link>
        <Link href={destinations.contact.href} className={`dashboard-utility-row ${studentFocusRow}`}>
          <LifeBuoy aria-hidden="true" size={20} className="dashboard-utility-icon" />
          <div><h3>{destinations.contact.label}</h3><p>Questions or something not working?</p></div>
          <ArrowRight aria-hidden="true" size={18} className="dashboard-utility-arrow" />
        </Link>
        <Link href={destinations.account.href} prefetch={false} className={`dashboard-utility-row ${studentFocusRow}`}>
          <UserRound aria-hidden="true" size={20} className="dashboard-utility-icon" />
          <div><h3>{destinations.account.label}</h3><p>Profile and academic settings.</p></div>
          <ArrowRight aria-hidden="true" size={18} className="dashboard-utility-arrow" />
        </Link>
      </div>
    </section>
  </>
}
