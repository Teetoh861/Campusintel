// app/courses/ai-practice/[courseId]/page.tsx — Personal AI practice for a course without verified content (PRD 4.3).
// Deliberately secondary: its own route, the Campus Bot label on every question set, and no official scoring.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { opensCampusBot, readCampusBotCourses } from '@/lib/ai-practice/campus-bot-courses'
import { isAiPracticeAvailable } from '@/lib/ai-practice/config'
import { aiPracticePath } from '@/lib/ai-practice/routes'
import { isAiPracticeEligible } from '@/lib/ai-practice/student-flow'
import { listPersonalSetsForCourse, readAllowance } from '@/lib/ai-practice/supabase-env'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseByIdForVerifiedStudent, isActionableStudentCourse, isLockedStudentCourse }
  from '@/lib/courses/read-model'
import { formatFreeMonthDay, trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { readProfileRevision } from '@/lib/profile/course-selection'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { AiPracticeClient } from './AiPracticeClient'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ courseId: string }> }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Practise from your notes | CampusIntell', robots: { index: false, follow: false } }

export default async function AiPracticePage({ params }: PageProps): Promise<ReactElement> {
  const { courseId } = await params
  return <StudentAccessGate returnPath={aiPracticePath(courseId)}>
    {continuityToken => <AiPracticeCourse courseId={courseId} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

function Unavailable({ title, message }: { title: string; message?: string }): ReactElement {
  return <StudentPage band={<PageBand title="Practise from your notes" />}>
    <Notice title={title} tone="info" action={<Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
      className={studentAction(btnGhost)}>{STUDENT_DESTINATIONS.myCourses.label}</Link>}>{message}</Notice>
  </StudentPage>
}

async function AiPracticeCourse({ courseId, continuityToken }: { courseId: string; continuityToken: string }):
  Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', aiPracticePath(courseId))
  const result = await getStudentCourseByIdForVerifiedStudent(client, courseId)
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', aiPracticePath(courseId))
  if (result.status !== 'ok') {
    return <StudentPage band={<PageBand title="Practise from your notes" />}>
      <ResultNotice state="course-unavailable" retryHref={aiPracticePath(courseId)} />
    </StudentPage>
  }
  const { course } = result
  // The link on a course row is shown by this same read and rule, so it never leads to the redirect below.
  const scoped = (await readCampusBotCourses(client, context.user, [course])).has(course.institutionalCourseId)
  // Already generated personal sets remain the owner's when course or AI access ends.
  const sets = await listPersonalSetsForCourse(client, context.user.id, course.institutionalCourseId)
  if (!opensCampusBot(scoped, sets.length > 0)) redirect(STUDENT_DESTINATIONS.myCourses.href)
  const enabled = isAiPracticeAvailable()
  if (!enabled && sets.length === 0) {
    return <Unavailable title="Campus Bot is unavailable." />
  }
  // A course with verified content always sends students to it; AI practice never competes with it.
  // A locked course is built too: its page explains how to unlock it.
  if (sets.length === 0 && (isActionableStudentCourse(course) || isLockedStudentCourse(course))) redirect(course.repository.route.href)
  if (sets.length === 0 && !isAiPracticeEligible(course)) {
    return <Unavailable title="This course isn’t available right now." message="Try again in a few minutes." />
  }
  // AI copy names the student's own grant (a Discovery Pass, or a seven-day trial issued before it) and offers a pass
  // only when this account can still start one; a read failure stays neutral. The free month is offered only when the
  // database says this student can claim it now, with the profile revision the month would be bound to.
  const [allowance, plan, profileRevision] = await Promise.all([readAllowance(client),
    readEntitlementForVerifiedStudent(client, { freeMonth: true }).catch(() => null),
    readProfileRevision(client, context.user.id)])
  const entitlement = plan !== null && plan.status === 'ok' ? plan.entitlement : null
  const trial = trialWording(entitlement)
  const freeMonth = entitlement !== null && entitlement.free_month !== null && profileRevision !== null
    ? { continuityToken, profileRevision, endsOn: formatFreeMonthDay(entitlement.free_month.endsAt) } : null
  return <StudentPage band={<PageBand title="Practise from your notes"
    context={<p className="ai-practice-context"><b>{course.code}</b> · {course.title}</p>} />}>
    {/* Keyed by what Campus Bot currently allows, so a month claimed here opens the upload form on the next read. */}
    <AiPracticeClient key={`${allowance?.state ?? 'unread'}:${allowance?.source ?? ''}`}
      courseId={course.institutionalCourseId} continuityToken={continuityToken}
      plansOnSale={entitlement !== null && entitlement.plans_on_sale} freeMonth={freeMonth}
      courseHref={course.repository.state === 'shelved' ? course.repository.route.href : undefined}
      initialAllowance={allowance} recentSets={sets} trial={trial}
      uploadsUnavailableReason={!scoped ? 'outside-list' : !enabled ? 'paused' : undefined}
      canGenerate={enabled && scoped && isAiPracticeEligible(course)} />
  </StudentPage>
}
