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
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { ProfileSelectionForm } from './ProfileSelectionForm'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile selection | CampusIntell', robots: { index: false, follow: false } }

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
  return <ProfilePageFrame title={complete ? 'Change selection' : 'Complete your profile'}
    description={complete ? 'Update your first name and academic details.' : 'Add your first name and confirm the details used for your courses.'} narrow>
    <AuthFlowSync signedIn continuityToken={continuityToken} />
    {profile.status === 'incomplete' || complete ? <ProfileSelectionForm initial={profile} continuityToken={continuityToken} /> : <div className="student-surface space-y-3">
      <Feedback tone="error" message={profile.status === 'missing-profile'
        ? 'Your profile could not be found. Please contact support.'
        : profile.status === 'invariant-failure'
          ? 'Your profile needs attention. Please contact support.'
          : AUTH_MESSAGES.unavailable} />
      <Link href={AUTH_PATHS.account} className={buttonClassName(btnBase, btnSm, btnGhost, studentFocusControl)}>Back to account</Link>
    </div>}
  </ProfilePageFrame>
}
