import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { Feedback } from '@/components/chrome/Feedback'
import { AUTH_MESSAGES, AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCourses } from '@/lib/dashboard/current-student-courses'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { CourseRow } from './CourseRow'
import type { ReactNode } from 'react'
import type { StudentProfileState } from '@/lib/profile/student-profile'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your semester | CampusIntell', robots: { index: false, follow: false } }

type CompleteProfile = Extract<StudentProfileState, { status: 'complete' }>
type ErrorState = 'missing-profile' | 'unavailable' | 'invariant-failure' | 'selection-changed'

function DashboardFrame({ children }: { children: ReactNode }) {
  return <section className="mx-auto w-full max-w-3xl px-5 pb-12 pt-5 min-[680px]:px-8 min-[680px]:pt-8">
    {children}
  </section>
}

function DashboardError({ state }: { state: ErrorState }) {
  const message = state === 'missing-profile'
    ? 'Your profile could not be found. Please contact support.'
    : state === 'invariant-failure'
      ? 'Your course information needs attention. Please contact support.'
      : state === 'selection-changed'
        ? 'Your semester selection changed. Reload to see the latest courses.'
        : AUTH_MESSAGES.unavailable
  return <DashboardFrame>
    <h1 className="mb-3 text-xl font-bold text-ci-navy-900">Your semester</h1>
    <Feedback message={message} tone="error" />
    {state === 'missing-profile' || state === 'invariant-failure'
      ? <Link href="/contact" className={AUTH_LINK}>Contact support</Link>
      : <a href={STUDENT_HOME_PATH} className={AUTH_LINK}>Try again</a>}
  </DashboardFrame>
}

function SemesterContext({ selection }: { selection: CompleteProfile['selection'] }) {
  const labels = [selection.department.label, selection.academicLevel.label, selection.academicPeriod.label]
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod]
    .some(item => !item.isActive)
  return <header className="flex items-start gap-3 border-b border-ci-border pb-3">
    <div className="min-w-0 flex-1">
      <h1 className="text-[15px] font-bold leading-5 text-ci-navy-900">Your semester</h1>
      <p className="mt-0.5 text-[14px] leading-5 text-ci-gray-700">{labels.join(' · ')}</p>
      {inactive && <p className="mt-1 text-[12px] leading-4 text-ci-gray-700">A saved choice is no longer selectable.</p>}
    </div>
    <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={AUTH_LINK + ' shrink-0 text-[14px]'}>
      Change<span className="sr-only"> semester selection</span>
    </Link>
  </header>
}

/** Render only the current session owner's persisted institutional semester. */
export default async function DashboardPage() {
  if (!isStudentAuthEnabled()) return <DashboardFrame>
    <h1 className="mb-3 text-xl font-bold text-ci-navy-900">Your semester</h1>
    <Feedback message={AUTH_MESSAGES.comingSoon} />
  </DashboardFrame>

  let continuityToken: string | undefined
  try {
    const context = await getStudentSessionContext()
    if (context !== null) continuityToken = issueAccountContinuityToken(context.user.id, context.sessionId)
  } catch { return <DashboardError state="unavailable" /> }
  if (!continuityToken) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))

  const result = await getCurrentStudentCourses()
  if (result.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))
  if (result.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  const continuity = <AuthFlowSync signedIn continuityToken={continuityToken} />
  if (result.status !== 'complete') return <>{continuity}<DashboardError state={result.status} /></>

  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_HOME_PATH))
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  if (profile.status !== 'complete') return <>{continuity}<DashboardError state={
    profile.status === 'missing-profile' || profile.status === 'invariant-failure'
      ? profile.status : 'unavailable'
  } /></>
  if (profile.selection.department.id !== result.selection.departmentId ||
      profile.selection.academicLevel.id !== result.selection.academicLevelId ||
      profile.selection.academicPeriod.id !== result.selection.academicPeriodId) {
    return <>{continuity}<DashboardError state="selection-changed" /></>
  }

  return <>{continuity}<DashboardFrame>
    <SemesterContext selection={profile.selection} />
    <h2 className="sr-only">Your courses</h2>
    {result.courses.length === 0
      ? <div className="py-5"><Feedback message="No confirmed courses for this selection yet." /></div>
      : <ul className="mt-2" aria-label="Your semester courses">
        {result.courses.map(course => <CourseRow key={course.institutionalCourseId} course={course} />)}
      </ul>}
  </DashboardFrame></>
}
