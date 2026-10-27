import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { Feedback } from '@/components/chrome/Feedback'
import { btnBase, buttonClassName, btnGhost, btnSm } from '@/components/chrome/ui'
import { studentFocusControl } from '@/components/student/ui'
import { ProfilePageFrame } from '@/components/profile/ProfilePageFrame'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { readCourseSelection } from '@/lib/profile/course-selection'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { createClient } from '@/lib/supabase/server'
import { ProfileSelectionForm } from './ProfileSelectionForm'
import type { CourseSelectionMode } from './ProfileSelectionForm'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile selection | CampusIntell', robots: { index: false, follow: false } }

/**
 * Locked when the database says the courses are set for the semester. A first pick while a plan or pass is running is
 * warned about, because that save sets them. Unknown lock or plan state withholds the form until a refresh.
 */
async function courseSelectionMode(): Promise<CourseSelectionMode | null> {
  try {
    const client = await createClient()
    const lock = await readCourseSelection(client)
    if (lock === null) return null
    if (lock.locked) return 'locked'
    if (lock.state !== 'incomplete') return 'open'
    const read = await readEntitlementForVerifiedStudent(client, { discoveryEligibility: false })
    if (read.status !== 'ok') return null
    const running = read.entitlement.tier === 'full' || read.entitlement.trial.status === 'active'
    return running ? 'first-pick' : 'open'
  } catch {
    return null
  }
}

/** Load the live student's profile on the server; only presentation data enters the form. */
export default async function ProfileSelectionPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <ProfilePageFrame title="Profile selection" narrow>
    <div className="student-surface"><AuthUnavailable /></div>
  </ProfilePageFrame>
  let continuityToken: string | undefined
  try {
    const context = await getStudentSessionContext()
    if (context !== null) continuityToken = issueAccountContinuityToken(context.user.id, context.sessionId)
  } catch {
    return <ProfilePageFrame title="Profile selection" narrow>
      <div className="student-surface"><Feedback tone="error" message={AUTH_MESSAGES.unavailable} /></div>
    </ProfilePageFrame>
  }
  if (!continuityToken) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') {
    redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
  }
  const complete = profile.status === 'complete'
  const mode = profile.status === 'incomplete' || complete ? await courseSelectionMode() : 'open'
  return <ProfilePageFrame title={mode === 'locked' ? 'Your details' : complete ? 'Change selection' : 'Complete your profile'}
    description={mode === null ? undefined : mode === 'locked' ? 'Update your first name.'
      : complete ? 'Update your first name and academic details.' : 'Add your first name and confirm the details used for your courses.'} narrow>
    <AuthFlowSync signedIn continuityToken={continuityToken} />
    {mode === null ? <div className="student-surface">
      <Feedback tone="error" message="We couldn't load your courses. Refresh the page to try again." />
    </div> : profile.status === 'incomplete' || complete ? <ProfileSelectionForm initial={profile} continuityToken={continuityToken} mode={mode} /> : <div className="student-surface space-y-3">
      <Feedback tone="error" message={profile.status === 'missing-profile'
        ? 'Your profile could not be found. Please contact support.'
        : profile.status === 'invariant-failure'
          ? 'Your profile needs attention. Please contact support.'
          : AUTH_MESSAGES.unavailable} />
      <Link href={AUTH_PATHS.account} className={buttonClassName(btnBase, btnSm, btnGhost, studentFocusControl)}>Back to account</Link>
    </div>}
  </ProfilePageFrame>
}
