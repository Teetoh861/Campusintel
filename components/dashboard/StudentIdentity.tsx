// components/dashboard/StudentIdentity.tsx — Real student and persisted academic identity.
import Link from 'next/link'
import { CBrandTexture } from '@/components/student/CBrandTexture'
import { studentAction } from '@/components/student/ui'
import { btnGhost } from '@/components/chrome/ui'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import type { StudentProfileState } from '@/lib/profile/student-profile'
import type { ReactElement } from 'react'

type Profile = Extract<StudentProfileState, { status: 'complete' }>

/** Introduce the student's study space without inferring identity from email or inventing data. */
export function StudentIdentity({ profile }: { profile: Profile }): ReactElement {
  const { selection } = profile
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod].some(option => !option.isActive)
  return <header className="dashboard-identity student-enter">
    <CBrandTexture tone="navy" />
    <div className="student-workspace dashboard-identity-layout relative">
      <div>
        <p className="dashboard-eyebrow">University of Lagos <span className="font-medium">· Your study space</span></p>
        <h1 className="dashboard-greeting">Welcome back, {profile.firstName}</h1>
      </div>
      <section aria-label="Your academic identity" className="dashboard-record">
        <dl className="dashboard-record-fields">
          <div className="dashboard-department"><dt>Department</dt><dd>{selection.department.label}</dd></div>
          <div><dt>Level</dt><dd>{selection.academicLevel.label}</dd></div>
          <div><dt>Semester</dt><dd>{selection.academicPeriod.label}</dd></div>
        </dl>
        <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnGhost, 'dashboard-change')}>
          Change<span className="sr-only"> first name and academic selection</span>
        </Link>
      </section>
      {inactive && <p className="mt-2 text-sm text-student-text-secondary">A saved academic choice is no longer selectable.</p>}
    </div>
  </header>
}
