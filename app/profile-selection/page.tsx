import { AuthUnavailableError, authUnavailableMessage, createAuthDiagnostic } from '@/lib/auth/unavailable'
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
import { AUTH_PATHS } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { readCourseSelection } from '@/lib/profile/course-selection'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH, PROFILE_TITLE, selectionReturnPath } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileSelectionForm } from './ProfileSelectionForm'
import type { CourseSelectionMode } from './ProfileSelectionForm'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: `${PROFILE_TITLE} | CampusIntell`, robots: { index: false, follow: false } }

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
export default async function ProfileSelectionPage({ searchParams }: { searchParams?: Promise<{ return?: string }> } = {}):
  Promise<ReactElement> {
  // Where a save returns to: only Confirm courses or a practice result (allow-listed); otherwise the home page.
  const diagnostic = createAuthDiagnostic('/profile-selection')
  const returnPath = selectionReturnPath((await searchParams)?.return)
  if (!isStudentAuthEnabled()) return <ProfilePageFrame title={PROFILE_TITLE} narrow>
    <div className="student-surface"><AuthUnavailable message={authUnavailableMessage('/profile-selection', new AuthUnavailableError('configuration'), diagnostic)} /></div>
  </ProfilePageFrame>
  let continuityToken: string | undefined
  try {
    const context = await getStudentSessionContext()
    if (context !== null) continuityToken = issueAccountContinuityToken(context.user.id, context.sessionId)
  } catch (error) {
    return <ProfilePageFrame title={PROFILE_TITLE} narrow>
      <div className="student-surface"><Feedback tone="error" message={authUnavailableMessage('/profile-selection', error, diagnostic)} /></div>
    </ProfilePageFrame>
  }
  if (!continuityToken) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') {
    redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
  }
  const complete = profile.status === 'complete'
  const mode = profile.status === 'incomplete' || complete ? await courseSelectionMode() : 'open'
  return <ProfilePageFrame title={PROFILE_TITLE}
    description={mode !== null && profile.status === 'incomplete' ? 'Set up your profile to see your courses.' : undefined} narrow>
    <AuthFlowSync signedIn continuityToken={continuityToken} />
    {mode === null ? <div className="student-surface">
      <Feedback tone="error" message={<>We couldn’t load your courses. <a href={PROFILE_SELECTION_PATH}
        className="underline underline-offset-2">Reload</a></>} />
    </div> : profile.status === 'incomplete' || complete ? <ProfileSelectionForm initial={profile} continuityToken={continuityToken} mode={mode}
      returnPath={returnPath} /> : <div className="student-surface space-y-3">
      <Feedback tone="error" message={profile.status === 'missing-profile' || profile.status === 'invariant-failure' ? <>
        {profile.status === 'missing-profile' ? 'We couldn’t find your profile.' : 'We couldn’t load your profile.'}{' '}
        <Link href={STUDENT_DESTINATIONS.contact.href} prefetch={false} className="whitespace-nowrap underline underline-offset-2">
          {STUDENT_DESTINATIONS.contact.label}</Link></> : authUnavailableMessage('/profile-selection', null, diagnostic)} />
      <Link href={AUTH_PATHS.account} className={buttonClassName(btnBase, btnSm, btnGhost, studentFocusControl)}>Back to profile</Link>
    </div>}
  </ProfilePageFrame>
}
