// app/account/page.tsx — Server-authorized student account and profile entry point.
import Link from 'next/link'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { redirect } from 'next/navigation'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_PATHS, AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { btnBase, btnGhost, btnSm, cx, focusRingNavy } from '@/components/chrome/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { SelectionSummary } from '@/components/profile/SelectionSummary'
import { ProfilePageFrame } from '@/components/profile/ProfilePageFrame'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account | CampusIntell', robots: { index: false, follow: false } }

/** Keep Auth and Profile independently validated at this protected student entry point. */
export default async function AccountPage() {
  if (!isStudentAuthEnabled()) return <ProfilePageFrame title="Your profile" narrow>
    <AuthUnavailable />
  </ProfilePageFrame>
  let email: string | undefined
  let continuityToken: string | undefined
  try {
    const context = await getStudentSessionContext()
    const user = context?.user ?? null
    email = user?.email
    if (user !== null && (typeof email !== 'string' || !email)) throw new Error('Student identity missing')
    if (context !== null) continuityToken = issueAccountContinuityToken(context.user.id, context.sessionId)
  } catch { return <ProfilePageFrame title="Your profile" narrow>
    <Feedback message={AUTH_MESSAGES.unavailable} tone="error" />
  </ProfilePageFrame> }
  if (!email || !continuityToken) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  return <ProfilePageFrame title="Your profile" back={{ href: STUDENT_HOME_PATH, label: 'Dashboard' }}>
    <AuthFlowSync signedIn continuityToken={continuityToken} />
    <div className="grid min-w-0 gap-3 tablet:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.9fr)] tablet:items-start tablet:gap-4 desktop:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] desktop:gap-6">
      <section aria-labelledby="academic-profile-heading"
        className="student-surface student-surface-raised border-student-border-strong bg-student-brand-surface">
        <div className="grid min-w-0 gap-3 tablet:grid-cols-[minmax(0,1fr)_auto] tablet:items-center">
          <h2 id="academic-profile-heading" className="student-section-title">Academic profile</h2>
          {profile.status === 'complete' ? <>
            <div className="min-w-0 tablet:col-span-2 tablet:row-start-2">
              <SelectionSummary selection={profile.selection} />
            </div>
            <Link href={PROFILE_SELECTION_PATH} prefetch={false}
              className={cx(btnBase, btnSm, btnGhost, focusRingNavy, 'w-full tablet:col-start-2 tablet:row-start-1 tablet:w-auto tablet:justify-self-end')}>
              Change selection
            </Link>
          </> : <div className="tablet:col-span-2">
            <Feedback tone="error" message={profile.status === 'missing-profile'
              ? 'Your profile could not be found. Please contact support.'
              : profile.status === 'invariant-failure'
                ? 'Your profile needs attention. Please contact support.'
                : AUTH_MESSAGES.unavailable} />
          </div>}
        </div>
      </section>
      <div className="grid min-w-0 gap-3 tablet:content-start">
        <section aria-labelledby="account-heading" className="student-surface">
          <h2 id="account-heading" className="text-base font-bold text-student-text-primary">Account</h2>
          <dl className="mt-3 min-w-0">
            <dt className="student-meta">Email</dt>
            <dd className="mt-1 font-semibold text-student-text-primary [overflow-wrap:anywhere]">{email}</dd>
          </dl>
        </section>
        <section aria-labelledby="settings-heading" className="student-surface bg-student-surface-muted">
          <h2 id="settings-heading" className="text-base font-bold text-student-text-primary">Settings</h2>
          <div className="mt-3"><LogoutButton /></div>
        </section>
      </div>
    </div>
  </ProfilePageFrame>
}
