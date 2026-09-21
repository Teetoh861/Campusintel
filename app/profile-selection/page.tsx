import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { Feedback } from '@/components/chrome/Feedback'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { ProfileSelectionForm } from './ProfileSelectionForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile selection | CampusIntell', robots: { index: false, follow: false } }

/** Load the live student's profile on the server; only presentation data enters the form. */
export default async function ProfileSelectionPage() {
  if (!isStudentAuthEnabled()) return <AuthShell title="Profile selection"><AuthUnavailable /></AuthShell>
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') {
    redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
  }
  const complete = profile.status === 'complete'
  return <AuthShell title={complete ? 'Change selection' : 'Profile selection'}>
    <AuthFlowSync signedIn />
    {profile.status === 'incomplete' || complete ? <ProfileSelectionForm initial={profile} /> : <>
      <Feedback tone="error" message={profile.status === 'missing-profile'
        ? 'Your profile could not be found. Please contact support.'
        : profile.status === 'invariant-failure'
          ? 'Your profile needs attention. Please contact support.'
          : AUTH_MESSAGES.unavailable} />
      <Link href={AUTH_PATHS.account} className={AUTH_LINK}>Back to account</Link>
    </>}
  </AuthShell>
}
