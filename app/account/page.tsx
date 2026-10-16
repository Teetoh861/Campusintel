// Server-authorized Student App account workspace.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { DeleteAccountForm } from '@/components/account/DeleteAccountForm'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost } from '@/components/chrome/ui'
import { StudentPage } from '@/components/student/StudentPage'
import { PageBand } from '@/components/student/PageBand'
import { studentAction } from '@/components/student/ui'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_PATHS, AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { SelectionSummary } from '@/components/profile/SelectionSummary'
import { createClient } from '@/lib/supabase/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account | CampusIntell', robots: { index: false, follow: false } }

/** Read identity, academic details and deletion eligibility from the live server session. */
export default async function AccountPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <StudentPage><AuthUnavailable /></StudentPage>
  let verified: {
    client: Awaited<ReturnType<typeof createClient>>
    context: NonNullable<Awaited<ReturnType<typeof getStudentSessionContext>>>
    continuityToken: string
    deletionAllowed: boolean
  } | null
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    const lifecycle = context ? await readAccountLifecycle(client) : null
    if (context && !context.user.email) throw new Error('Student identity missing')
    verified = context && lifecycle?.status === 'active' ? { client, context,
      continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId),
      deletionAllowed: lifecycle?.status === 'active' && lifecycle.deletionAllowed } : null
  } catch { return <StudentPage><Feedback message={AUTH_MESSAGES.unavailable} tone="error" /></StudentPage> }
  if (!verified) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  const { client, context, continuityToken, deletionAllowed } = verified
  const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login)
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  return <><AuthFlowSync signedIn continuityToken={continuityToken} />
    <StudentPage band={<PageBand title="Account" lede="Your profile, academic details and account settings."
      aside={<Link href={STUDENT_HOME_PATH} className={studentAction(btnGhost)}>Dashboard</Link>} />}>
      <div className="grid min-w-0 gap-4 tablet:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.9fr)] desktop:gap-6">
        <div className="grid min-w-0 content-start gap-4">
          <section aria-labelledby="personal-details-heading" className="student-surface student-surface-raised">
            <h2 id="personal-details-heading" className="student-section-title">Personal details</h2>
            <dl className="mt-4 min-w-0">
              {profile.status === 'complete' && <>
                <dt className="student-meta">First name</dt>
                <dd className="mb-4 mt-1 font-semibold text-student-text-primary [overflow-wrap:anywhere]">{profile.firstName}</dd>
              </>}
              <dt className="student-meta">Email</dt>
              <dd className="mt-1 font-semibold text-student-text-primary [overflow-wrap:anywhere]">{context.user.email}</dd>
            </dl>
            <p className="mt-3 text-sm text-student-text-secondary">Your confirmed email is used to sign in.</p>
          </section>
          <section aria-labelledby="academic-profile-heading" className="student-surface bg-student-brand-surface">
            <h2 id="academic-profile-heading" className="student-section-title">Academic profile</h2>
            {profile.status === 'complete' ? <>
              <div className="mt-4 min-w-0"><SelectionSummary selection={profile.selection} /></div>
              <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnGhost, 'mt-4')}>Edit profile and selection</Link>
            </> : <div className="mt-3"><Feedback tone="error" message={profile.status === 'missing-profile'
              ? 'Your profile could not be found. Please contact support.' : profile.status === 'invariant-failure'
                ? 'Your profile needs attention. Please contact support.' : AUTH_MESSAGES.unavailable} /></div>}
          </section>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <section aria-labelledby="security-heading" className="student-surface">
            <h2 id="security-heading" className="student-section-title">Security</h2>
            <p className="mb-4 mt-2 text-sm text-student-text-secondary">Sign out of this device when you finish using a shared computer.</p>
            <LogoutButton continuityToken={continuityToken} />
          </section>
          {deletionAllowed ? <DeleteAccountForm continuityToken={continuityToken} /> : <section className="student-surface">
            <h2 className="student-section-title">Account management</h2>
            <p className="mt-2 text-sm text-student-text-secondary">Operator account changes require an operations review.</p>
          </section>}
        </div>
      </div>
    </StudentPage>
  </>
}
