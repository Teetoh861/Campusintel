// app/dashboard/page.tsx — Request-scoped Student App command centre; semester courses live at /my-courses.
import Link from 'next/link'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { StudentIdentity } from '@/components/dashboard/StudentIdentity'
import { PrimaryCards } from '@/components/dashboard/PrimaryCards'
import { SupportingActions } from '@/components/dashboard/SupportingActions'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost } from '@/components/chrome/ui'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/courses/read-model'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard | CampusIntell', robots: { index: false, follow: false } }

/** Validate the live session and complete real profile before rendering private student identity. */
export default async function DashboardPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <StudentPage><Feedback message={AUTH_MESSAGES.comingSoon} /></StudentPage>
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
  } catch { return <StudentPage><Feedback tone="error" message={AUTH_MESSAGES.unavailable} /></StudentPage> }
  if (!verified) redirectForStudentState('signed-out', STUDENT_HOME_PATH)
  const { client, context, continuityToken } = verified
  const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
  if (profile.status === 'signed-out' || profile.status === 'incomplete') redirectForStudentState(profile.status, STUDENT_HOME_PATH)
  const continuity = <AuthFlowSync signedIn continuityToken={continuityToken} />
  if (profile.status !== 'complete') return <>{continuity}<StudentPage>
    <h1 className="student-title mb-3">Dashboard</h1>
    {profile.status === 'missing-profile'
      ? <ResultNotice state="missing-profile" retryHref={STUDENT_HOME_PATH} />
      : <>
        <Feedback tone="error" message={AUTH_MESSAGES.unavailable} />
        <Link href={STUDENT_DESTINATIONS.contact.href} className={studentAction(btnGhost, 'mt-3')}>Contact support</Link>
      </>}
  </StudentPage></>
  const current = await getCurrentStudentCoursesForVerifiedStudent(client, context.user)
  if (current.status === 'signed-out' || current.status === 'incomplete') redirectForStudentState(current.status, STUDENT_HOME_PATH)
  // A selection changed during this request must not produce mismatched statistics.
  const courses = current.status === 'ok' &&
    current.selection.departmentId === profile.selection.department.id &&
    current.selection.academicLevelId === profile.selection.academicLevel.id &&
    current.selection.academicPeriodId === profile.selection.academicPeriod.id
    ? current.courses : null
  return <>{continuity}<StudentPage band={<StudentIdentity profile={profile} />} workspaceClassName="dashboard-workspace">
    <PrimaryCards courses={courses} />
    <SupportingActions />
  </StudentPage></>
}
