// app/account/page.tsx — Server-authorized student account and profile entry point.
import Link from 'next/link'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { redirect } from 'next/navigation'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_PATHS, AUTH_MESSAGES } from '@/lib/auth/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { SelectionSummary } from '@/components/profile/SelectionSummary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account | CampusIntell', robots: { index: false, follow: false } }

/** Keep Auth and Profile independently validated at this protected student entry point. */
export default async function AccountPage() {
  if (!isStudentAuthEnabled()) return <AuthShell title="Account"><AuthUnavailable /></AuthShell>
  let email: string | undefined
  try {
    const user = await getStudentSessionUser()
    email = user?.email
    if (user !== null && (typeof email !== 'string' || !email)) throw new Error('Student identity missing')
  } catch { return <AuthShell title="Account"><Feedback message={AUTH_MESSAGES.unavailable} tone="error" /></AuthShell> }
  if (!email) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  return <AuthShell title="Account">
    <AuthFlowSync signedIn />
    <p className="break-words">Signed in as {email}</p>
    {profile.status === 'complete' ? <div className="space-y-2 border-t border-ci-border pt-3">
      <h2 className="font-semibold text-ci-navy">Your selection</h2>
      <SelectionSummary selection={profile.selection} />
      <Link href={PROFILE_SELECTION_PATH} className={AUTH_LINK}>Change selection</Link>
    </div> : <Feedback tone="error" message={profile.status === 'missing-profile'
      ? 'Your profile could not be found. Please contact support.'
      : profile.status === 'invariant-failure'
        ? 'Your profile needs attention. Please contact support.'
        : AUTH_MESSAGES.unavailable} />}
    <LogoutButton />
  </AuthShell>
}
