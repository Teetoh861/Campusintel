// app/dashboard/page.tsx — Request-scoped Student App home with course-file navigation and personal Continue practice.
// At the top, only for a student the database says can claim it now: the free access card; once claimed, its last day.
import Link from 'next/link'
import { FreeMonthCard } from '@/app/access/FreeMonthOffer'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { ContinueCard } from '@/components/dashboard/ContinueCard'
import { StudentIdentity } from '@/components/dashboard/StudentIdentity'
import { PrimaryCards } from '@/components/dashboard/PrimaryCards'
import { SupportingActions } from '@/components/dashboard/SupportingActions'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost } from '@/components/chrome/ui'
import { AccessNotice } from '@/components/student/AccessNotice'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent, getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { homeCoursesFrom, offListOpenCourse } from '@/lib/dashboard/home-courses'
import type { CourseLabels } from '@/lib/dashboard/home-courses'
import { FREE_MONTH_COPY, accessNotice, formatFreeMonthDay, freeMonthClaim } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { readPracticeProgress } from '@/lib/practice/progress'
import { readProfileRevision } from '@/lib/profile/course-selection'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard | CampusIntell', robots: { index: false, follow: false } }

type StudentClient = Awaited<ReturnType<typeof createClient>>

/** The verified catalogue code and title of an open attempt's course that is not on the student's list, read as its
 *  course page reads it; none when it has no catalogue course or cannot be read now. */
async function offListLabels(client: StudentClient, course: { courseId: string; slug: string } | null): Promise<CourseLabels> {
  if (course === null) return new Map()
  const read = await getStudentCourseBySlugForVerifiedStudent(client, course.slug, { readRepositoryOnly: false })
    .catch(() => null)
  return read?.status === 'ok' && read.course.repository.repositoryCourseId === course.courseId
    ? new Map([[course.courseId, { code: read.course.code, title: read.course.title }]]) : new Map()
}

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
        <Link href={STUDENT_DESTINATIONS.contact.href} className={studentAction(btnGhost, 'mt-3')}>{STUDENT_DESTINATIONS.contact.label}</Link>
      </>}
  </StudentPage></>
  // One practice read for every course, for this verified session only.
  const [current, entitlement, progress, profileRevision] = await Promise.all([
    getCurrentStudentCoursesForVerifiedStudent(client, context.user),
    readEntitlementForVerifiedStudent(client, { freeMonth: true }), readPracticeProgress(context.sessionId),
    readProfileRevision(client, context.user.id)])
  if (current.status === 'signed-out' || current.status === 'incomplete') redirectForStudentState(current.status, STUDENT_HOME_PATH)
  // A selection changed during this request must not produce mismatched courses or figures.
  const matching = current.status === 'ok' &&
    current.selection.departmentId === profile.selection.department.id &&
    current.selection.academicLevelId === profile.selection.academicLevel.id &&
    current.selection.academicPeriodId === profile.selection.academicPeriod.id
    ? current : null
  const home = matching === null ? null : homeCoursesFrom(matching.courses, matching.cbtBankSizes, progress,
    await offListLabels(client, offListOpenCourse(matching.courses, progress)))
  const plan = entitlement.status === 'ok' ? entitlement.entitlement : null
  // The free month card, only when the database says this student can claim it now. Without the revision the month
  // could set courses the student did not see (D7), so nothing is offered.
  const freeMonth = plan === null ? null : freeMonthClaim(plan, continuityToken, profileRevision)
  // Free access that is running, by the last day the database's end covers. In its last hours the notice below says
  // when it ends, so the line is not said twice.
  const running = plan !== null && plan.paid === null && plan.access?.source === 'early_access'
    && accessNotice(plan)?.id !== 'access-ending' ? plan.access.ends_at : null
  return <>{continuity}<StudentPage band={<StudentIdentity profile={profile} canChange={plan?.access?.source === 'tester'} />} workspaceClassName="dashboard-workspace">
    {freeMonth !== null && <FreeMonthCard {...freeMonth} />}
    {running !== null && <p className="dashboard-free-month student-enter" data-free-month="active">
      {FREE_MONTH_COPY.active(formatFreeMonthDay(running))}</p>}
    <AccessNotice entitlement={plan} />
    {home?.continuePractice && <ContinueCard next={home.continuePractice} />}
    <PrimaryCards courses={matching?.courses ?? null} />
    <SupportingActions />
  </StudentPage></>
}
