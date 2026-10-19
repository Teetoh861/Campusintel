// app/my-courses/page.tsx — Request-scoped semester register with verified academic context.
import Link from 'next/link'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { CourseRegister } from '@/components/student/CourseRow'
import { EmptyState } from '@/components/student/EmptyState'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentCourseRow } from '@/components/student/StudentCourseRow'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { INACTIVE_SELECTION_COPY } from '@/components/student/selection-copy'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { AUTH_MESSAGES } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent, getStudentCourseUnavailability,
  isActionableStudentCourse } from '@/lib/courses/read-model'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import type { ResultStateId } from '@/components/student/result-state'
import type { ReactElement } from 'react'
import type { StudentProfileState } from '@/lib/profile/student-profile'

const MY_COURSES_PATH = STUDENT_DESTINATIONS.myCourses.href
const MY_COURSES_LEDE = 'Your semester, in one place.'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Courses | CampusIntell', robots: { index: false, follow: false } }

type CompleteProfile = Extract<StudentProfileState, { status: 'complete' }>
type ErrorState = 'missing-profile' | 'unavailable' | 'invariant-failure' | 'selection-changed'

const RESULT_STATE: Record<Exclude<ErrorState, 'selection-changed'>, ResultStateId> = {
  'missing-profile': 'missing-profile', 'unavailable': 'courses-unavailable', 'invariant-failure': 'course-invariant',
}

function MyCoursesBand(props: Omit<Parameters<typeof PageBand>[0], 'title' | 'lede'>): ReactElement {
  return <PageBand title={STUDENT_DESTINATIONS.myCourses.label} lede={MY_COURSES_LEDE} {...props} />
}

function MyCoursesError({ state }: { state: ErrorState }): ReactElement {
  return <StudentPage band={<MyCoursesBand />}>
    {state === 'selection-changed'
      // Unique to this surface: the saved selection moved while the page was composing.
      ? <Notice title="Study context changed" action={
        <a href={MY_COURSES_PATH} className={studentAction(btnGhost, 'bg-student-surface')}>Try again</a>
      }>Your semester selection changed. Reload to see the latest courses.</Notice>
      : <ResultNotice state={RESULT_STATE[state]} retryHref={MY_COURSES_PATH} />}
  </StudentPage>
}

function SemesterContext({ selection, total, ready }: {
  selection: CompleteProfile['selection']; total: number; ready: number
}): ReactElement {
  const labels = [selection.department.label, selection.academicLevel.label, selection.academicPeriod.label]
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod].some(item => !item.isActive)
  return <MyCoursesBand
    context={<p>{labels.join(' · ')}{inactive && <span className="student-context-inactive">{INACTIVE_SELECTION_COPY.sentence}</span>}</p>}
    aside={<div className="student-band-actions">
      {total > 0 && <p className="student-summary">{total} {total === 1 ? 'course' : 'courses'} · {ready} ready to study</p>}
      <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
        Change<span className="sr-only"> semester selection</span>
      </Link>
    </div>} />
}

/** Render only the current session owner's persisted institutional semester. */
export default async function MyCoursesPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <StudentPage band={<MyCoursesBand />}>
    <Notice title="My Courses is not available yet" tone="info">{AUTH_MESSAGES.comingSoon}</Notice>
  </StudentPage>

  let verified: {
    client: Awaited<ReturnType<typeof createClient>>
    context: NonNullable<Awaited<ReturnType<typeof getStudentSessionContext>>>
    continuityToken: string
  } | null
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    verified = context === null ? null : {
      client, context,
      continuityToken: issueAccountContinuityToken(context.user.id, context.sessionId),
    }
  } catch { return <MyCoursesError state="unavailable" /> }
  if (verified === null) redirectForStudentState('signed-out', MY_COURSES_PATH)
  const { client, context, continuityToken } = verified

  const result = await getCurrentStudentCoursesForVerifiedStudent(client, context.user)
  if (result.status === 'signed-out' || result.status === 'incomplete') redirectForStudentState(result.status, MY_COURSES_PATH)
  const continuity = <AuthFlowSync signedIn continuityToken={continuityToken} />
  if (result.status !== 'ok') return <>{continuity}<MyCoursesError state={result.status} /></>

  const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
  if (profile.status === 'signed-out' || profile.status === 'incomplete') redirectForStudentState(profile.status, MY_COURSES_PATH)
  if (profile.status !== 'complete') return <>{continuity}<MyCoursesError state={
    profile.status === 'missing-profile' || profile.status === 'invariant-failure'
      ? profile.status : 'unavailable'
  } /></>
  if (profile.selection.department.id !== result.selection.departmentId ||
      profile.selection.academicLevel.id !== result.selection.academicLevelId ||
      profile.selection.academicPeriod.id !== result.selection.academicPeriodId) {
    return <>{continuity}<MyCoursesError state="selection-changed" /></>
  }

  return <>{continuity}<StudentPage band={<SemesterContext selection={profile.selection} total={result.courses.length}
    ready={result.courses.filter(isActionableStudentCourse).length} />}>
    {result.courses.length === 0
      ? <EmptyState title="No confirmed courses for this selection yet." actions={<>
        <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>Change selection</Link>
        <Link href={STUDENT_DESTINATIONS.courses.href} prefetch={false} className={studentAction(btnGhost)}>Browse All Courses</Link>
      </>}>
        CampusIntell hasn’t confirmed the course list for this academic selection yet. Check your selection, or look through the full library.
      </EmptyState>
      : <section aria-labelledby="my-courses-list-title">
        <h2 id="my-courses-list-title" className="sr-only">Courses this semester</h2>
        <CourseRegister label="Your semester courses">
          {result.courses.map(course => <StudentCourseRow key={course.institutionalCourseId} course={course} />)}
        </CourseRegister>
        {result.courses.some(course => getStudentCourseUnavailability(course) === 'missing') &&
          <div className="student-register-request">
            <p>Missing material for one of your courses?</p>
            <Link href={STUDENT_DESTINATIONS.materials.href} prefetch={false} className={studentAction('student-register-request-link')}>
              {STUDENT_DESTINATIONS.materials.label}
            </Link>
          </div>}
      </section>}
  </StudentPage></>
}
