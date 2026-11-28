// components/dashboard/StudentIdentity.tsx — Real student and persisted academic identity.
import Link from 'next/link'
import { CBrandTexture } from '@/components/student/CBrandTexture'
import { studentAction } from '@/components/student/ui'
import { btnGhost } from '@/components/chrome/ui'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { SelectionChangeHelp } from '@/components/profile/SelectionChangeHelp'
import type { StudentProfileState } from '@/lib/profile/student-profile'
import type { ReactElement } from 'react'

type Profile = Extract<StudentProfileState, { status: 'complete' }>

/** Introduce the student's study space without inferring identity from email or inventing data. */
export function StudentIdentity({ profile, canChange = false }: { profile: Profile; canChange?: boolean }): ReactElement {
  const { selection } = profile
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod].some(option => !option.isActive)
  return <header className="dashboard-identity student-enter">
    <CBrandTexture tone="navy" />
    <div className="student-workspace dashboard-identity-layout relative">
      <div>
        <p className="dashboard-eyebrow">University of Lagos</p>
        <h1 className="dashboard-greeting">Hi, {profile.firstName}</h1>
      </div>
      <section aria-label="Your academic details" className="dashboard-record" data-can-change={canChange}>
        <dl className="dashboard-record-fields">
          <div className="dashboard-department"><dt>Department</dt><dd>{selection.department.label}</dd></div>
          <div><dt>Level</dt><dd>{selection.academicLevel.label}</dd></div>
          <div><dt>Semester</dt><dd>{selection.academicPeriod.label}</dd></div>
        </dl>
        {canChange && <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnGhost, 'dashboard-change')}>
          Change<span className="sr-only"> first name and academic details</span>
        </Link>}
        {(!canChange || inactive) && <div className="dashboard-selection-help"><SelectionChangeHelp inactive={inactive} /></div>}
      </section>
    </div>
  </header>
}
