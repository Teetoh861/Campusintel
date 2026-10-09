// app/dashboard/page.tsx — Request-scoped Student App command centre; semester courses live at /my-courses.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { StudentIdentity } from '@/components/dashboard/StudentIdentity'
import { PrimaryCards } from '@/components/dashboard/PrimaryCards'
import { SupportingActions } from '@/components/dashboard/SupportingActions'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_MESSAGES, AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/dashboard/current-student-courses'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard | CampusIntell', robots: { index: false, follow: false } }

/** Validate the live session and complete real profile before rendering private student identity. */
export default async function DashboardPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <div className="student-workspace student-page" data-student-app>
    <Feedback message={AUTH_MESSAGES.comingSoon} />
  </div>
  let verified: {
    client: Awaited<ReturnType<typeof createClient>>
    context: NonNullable<Awaited<ReturnType<typeof getStudentSessionContext>>>
    continuityToken: string
  } | null
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    verified = context === null ? null : { client, context,
      continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId) }
  } catch { return <div className="student-workspace student-page"><Feedback tone="error" message={AUTH_MESSAGES.unavailable} /></div> }
  if (!verified) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))
  const { client, context, continuityToken } = verified
  const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  const continuity = <AuthFlowSync signedIn continuityToken={continuityToken} />
  if (profile.status !== 'complete') return <>{continuity}<div className="student-workspace student-page" data-student-app>
    <h1 className="student-title mb-3">Dashboard</h1>
    <Feedback tone="error" message={profile.status === 'missing-profile'
      ? 'Your profile could not be found. Please contact support.' : AUTH_MESSAGES.unavailable} />
    <Link href={STUDENT_DESTINATIONS.contact.href} className={studentAction(btnGhost, 'mt-3')}>Contact support</Link>
  </div></>
  const current = await getCurrentStudentCoursesForVerifiedStudent(client, context.user)
  if (current.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))
  if (current.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  // A selection changed during this request must not produce mismatched statistics.
  const courses = current.status === 'complete' &&
    current.selection.departmentId === profile.selection.department.id &&
    current.selection.academicLevelId === profile.selection.academicLevel.id &&
    current.selection.academicPeriodId === profile.selection.academicPeriod.id
    ? current.courses : null
  return <>{continuity}<div className="dashboard-page" data-student-app>
    <StudentIdentity profile={profile} />
    <div className="student-workspace dashboard-workspace">
      <PrimaryCards courses={courses} />
      <SupportingActions />
    </div>
  </div></>
}
