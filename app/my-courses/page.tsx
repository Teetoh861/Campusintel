// app/my-courses/page.tsx — Preserved request-scoped semester courses for the current student.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, BookOpen, UserRound } from 'lucide-react'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { Feedback } from '@/components/chrome/Feedback'
import { btnBase, buttonClassName, btnGhost, btnSm, cx } from '@/components/chrome/ui'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/dashboard/current-student-courses'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { createClient } from '@/lib/supabase/server'
import { CourseRow } from './CourseRow'
import { studentFocusControl } from '@/components/student/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement, ReactNode } from 'react'
import type { StudentProfileState } from '@/lib/profile/student-profile'

const focusRingNavy = studentFocusControl
const MY_COURSES_PATH = STUDENT_DESTINATIONS.myCourses.href

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Courses | CampusIntell', robots: { index: false, follow: false } }

type CompleteProfile = Extract<StudentProfileState, { status: 'complete' }>
type ErrorState = 'missing-profile' | 'unavailable' | 'invariant-failure' | 'selection-changed'

function MyCoursesFrame({ children }: { children: ReactNode }) {
  return <div className="app-container student-workspace student-page" data-student-app>
    {children}
  </div>
}

function MyCoursesError({ state }: { state: ErrorState }) {
  const message = state === 'missing-profile'
    ? 'Your profile could not be found. Please contact support.'
    : state === 'invariant-failure'
      ? 'Your course information needs attention. Please contact support.'
      : state === 'selection-changed'
        ? 'Your semester selection changed. Reload to see the latest courses.'
        : AUTH_MESSAGES.unavailable
  return <MyCoursesFrame>
    <section className="student-reading">
      <h1 className="mb-3 text-xl font-bold text-student-text-primary">My Courses</h1>
      <Feedback message={message} tone="error" />
      {state === 'missing-profile' || state === 'invariant-failure'
        ? <Link href={STUDENT_DESTINATIONS.contact.href} className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'mt-3')}>Contact support</Link>
        : <a href={MY_COURSES_PATH} className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'mt-3')}>Try again</a>}
    </section>
  </MyCoursesFrame>
}

function SemesterContext({ selection }: { selection: CompleteProfile['selection'] }) {
  const labels = [selection.department.label, selection.academicLevel.label, selection.academicPeriod.label]
  const inactive = [selection.department, selection.academicLevel, selection.academicPeriod]
    .some(item => !item.isActive)
  return <header className="flex items-start gap-3 rounded-ci-card border border-student-border bg-student-brand-surface px-3 py-3 tablet:items-center tablet:px-5 tablet:py-4 desktop:px-6">
    <div className="min-w-0 flex-1">
      <h1 className="text-[16px] font-bold leading-5 text-student-text-primary tablet:text-[18px]">My Courses</h1>
      <p className="mt-0.5 text-[13px] leading-[1.35] text-student-text-secondary tablet:text-[15px]">{labels.join(' · ')}</p>
      {inactive && <p className="mt-1 text-[12px] leading-4 text-student-text-secondary">A saved choice is no longer selectable.</p>}
    </div>
    <Link href={PROFILE_SELECTION_PATH} prefetch={false}
      className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'shrink-0 !px-3')}>
      Change<span className="sr-only"> semester selection</span>
    </Link>
  </header>
}

function QuickLinks() {
  return <aside aria-labelledby="my-courses-utilities-title" className="min-w-0 desktop:col-start-2 desktop:row-start-1">
    <h2 id="my-courses-utilities-title" className="mb-2 text-[14px] font-bold text-student-text-primary tablet:text-[16px]">Quick links</h2>
    <div className="grid grid-cols-2 gap-2 tablet:gap-3 desktop:grid-cols-1">
      <Link href={STUDENT_DESTINATIONS.courses.href} prefetch={false}
        className={cx('student-surface flex min-h-11 items-center gap-2 !p-3 text-[14px] font-semibold text-student-primary desktop:hover:border-student-border-hover', focusRingNavy)}>
        <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0">{STUDENT_DESTINATIONS.courses.label}</span>
        <ArrowUpRight aria-hidden="true" className="ml-auto hidden h-4 w-4 shrink-0 desktop:block" />
      </Link>
      <Link href={STUDENT_DESTINATIONS.account.href} prefetch={false}
        className={cx('student-surface flex min-h-11 items-center gap-2 !p-3 text-[14px] font-semibold text-student-primary desktop:hover:border-student-border-hover', focusRingNavy)}>
        <UserRound aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0">{STUDENT_DESTINATIONS.account.label}</span>
        <ArrowUpRight aria-hidden="true" className="ml-auto hidden h-4 w-4 shrink-0 desktop:block" />
      </Link>
    </div>
  </aside>
}

/** Render only the current session owner's persisted institutional semester. */
export default async function MyCoursesPage(): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <MyCoursesFrame>
    <h1 className="mb-3 text-xl font-bold text-student-text-primary">My Courses</h1>
    <Feedback message={AUTH_MESSAGES.comingSoon} />
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
    <SemesterContext selection={profile.selection} />
    <div className="mt-4 grid min-w-0 gap-6 desktop:mt-6 desktop:grid-cols-[minmax(0,1fr)_minmax(240px,280px)] desktop:items-start desktop:gap-8">
      <section aria-labelledby="my-courses-list-title" className="min-w-0 desktop:col-start-1 desktop:row-start-1">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id="my-courses-list-title" className="student-section-title">Your courses</h2>
          <Link href={STUDENT_DESTINATIONS.bookmarks.href} prefetch={false}
            className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'shrink-0 !px-3')}>
            Bookmarks<span className="sr-only"> courses</span>
          </Link>
        </div>
        {result.courses.length === 0
          ? <div className="mt-3"><Feedback message="No confirmed courses for this selection yet." /></div>
          : <ul className="mt-3 grid min-w-0 gap-2 tablet:grid-cols-2 tablet:gap-3" aria-label="Your semester courses">
            {result.courses.map(course => <CourseRow key={course.institutionalCourseId} course={course} />)}
          </ul>}
      </section>
      <QuickLinks />
    </div>
  </MyCoursesFrame></>
}
