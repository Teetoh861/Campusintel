// app/my-courses/page.tsx — Request-scoped semester register with verified academic context.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { CourseRegister } from '@/components/student/CourseRow'
import { EmptyState } from '@/components/student/EmptyState'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/dashboard/current-student-courses'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { CourseRow } from './CourseRow'
import type { ReactElement, ReactNode } from 'react'
import type { StudentProfileState } from '@/lib/profile/student-profile'

const MY_COURSES_PATH = STUDENT_DESTINATIONS.myCourses.href

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Courses | CampusIntell', robots: { index: false, follow: false } }

type CompleteProfile = Extract<StudentProfileState, { status: 'complete' }>
type ErrorState = 'missing-profile' | 'unavailable' | 'invariant-failure' | 'selection-changed'

function MyCoursesFrame({ children }: { children: ReactNode }): ReactElement {
  return <div className="student-register-page" data-student-app>{children}</div>
}

function MyCoursesError({ state }: { state: ErrorState }): ReactElement {
  const message = state === 'missing-profile'
    ? 'Your profile could not be found. Please contact support.'
    : state === 'invariant-failure'
      ? 'Your course information needs attention. Please contact support.'
      : state === 'selection-changed'
        ? 'Your semester selection changed. Reload to see the latest courses.'
        : 'We couldn’t load your courses just now. Your selection is saved.'
  const title = state === 'missing-profile' ? 'Profile unavailable'
    : state === 'invariant-failure' ? 'Course information needs attention'
      : state === 'selection-changed' ? 'Study context changed' : 'Courses temporarily unavailable'
  return <MyCoursesFrame>
    <PageBand title="My Courses" lede="Your semester, in one place." />
    <div className="student-workspace student-register-workspace">
      <Notice title={title} action={state === 'missing-profile' || state === 'invariant-failure'
        ? <Link href={STUDENT_DESTINATIONS.contact.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Contact support</Link>
        : <a href={MY_COURSES_PATH} className={studentAction(btnGhost, 'bg-student-surface')}>Try again</a>}>
        {message}
      </Notice>
    </div>
  </MyCoursesFrame>
}

function SemesterContext({ selection, total, ready }: {
  selection: CompleteProfile['selection']; total: number; ready: number
}): ReactElement {
  const labels = [selection.department.label, selection.academicLevel.label, selection.academicPeriod.label]
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod].some(item => !item.isActive)
  return <PageBand title="My Courses" lede="Your semester, in one place."
    context={<p>{labels.join(' · ')}{inactive && <span className="student-context-inactive">A saved choice is no longer selectable.</span>}</p>}
    aside={<div className="student-register-context-actions">
      {total > 0 && <p className="student-register-summary">{total} {total === 1 ? 'course' : 'courses'} · {ready} ready to study</p>}
      <Link href={PROFILE_SELECTION_PATH} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
        Change<span className="sr-only"> semester selection</span>
      </Link>
    </div>} />
}

/** Render only the current session owner's persisted institutional semester. */
export default async function MyCoursesPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <MyCoursesFrame>
    <PageBand title="My Courses" lede="Your semester, in one place." />
    <div className="student-workspace student-register-workspace">
      <Notice title="My Courses is not available yet" tone="info">{AUTH_MESSAGES.comingSoon}</Notice>
    </div>
  </MyCoursesFrame>

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
  if (verified === null) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(MY_COURSES_PATH))
  const { client, context, continuityToken } = verified

  const result = await getCurrentStudentCoursesForVerifiedStudent(client, context.user)
  if (result.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(MY_COURSES_PATH))
  if (result.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  const continuity = <AuthFlowSync signedIn continuityToken={continuityToken} />
  if (result.status !== 'complete') return <>{continuity}<MyCoursesError state={result.status} /></>

  const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
  if (profile.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(MY_COURSES_PATH))
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  if (profile.status !== 'complete') return <>{continuity}<MyCoursesError state={
    profile.status === 'missing-profile' || profile.status === 'invariant-failure'
      ? profile.status : 'unavailable'
  } /></>
  if (profile.selection.department.id !== result.selection.departmentId ||
      profile.selection.academicLevel.id !== result.selection.academicLevelId ||
      profile.selection.academicPeriod.id !== result.selection.academicPeriodId) {
    return <>{continuity}<MyCoursesError state="selection-changed" /></>
  }

  return <>{continuity}<MyCoursesFrame>
    <SemesterContext selection={profile.selection} total={result.courses.length}
      ready={result.courses.filter(course => course.content.state === 'ready').length} />
    <div className="student-workspace student-register-workspace">
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
            {result.courses.map(course => <CourseRow key={course.institutionalCourseId} course={course} />)}
          </CourseRegister>
          {result.courses.some(course => course.content.state === 'not-built' || course.content.state === 'no-learning') &&
            <div className="student-register-request">
              <p>Missing material for one of your courses?</p>
              <Link href={STUDENT_DESTINATIONS.materials.href} prefetch={false} className={studentAction('student-register-request-link')}>
                {STUDENT_DESTINATIONS.materials.label}<ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />
              </Link>
            </div>}
        </section>}
    </div>
  </MyCoursesFrame></>
}
