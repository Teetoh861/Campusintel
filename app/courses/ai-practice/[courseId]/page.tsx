// app/courses/ai-practice/[courseId]/page.tsx — Personal AI practice for a course without verified content (PRD 4.3).
// Deliberately secondary: its own route, an unverified label on every surface, and no official scoring.
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
import { isAiPracticeAvailable } from '@/lib/ai-practice/config'
import { aiPracticePath } from '@/lib/ai-practice/routes'
import { isAiPracticeEligible } from '@/lib/ai-practice/student-flow'
import { listPersonalSetsForCourse, readAllowance } from '@/lib/ai-practice/supabase-env'
import { getCourseAccessForVerifiedStudent } from '@/lib/courses/access'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseByIdForVerifiedStudent, isActionableStudentCourse, isLockedStudentCourse }
  from '@/lib/courses/read-model'
import { trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { AiPracticeClient } from './AiPracticeClient'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ courseId: string }> }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Practise from your notes | CampusIntell', robots: { index: false, follow: false } }

const LEDE = 'With AI access on your account, use your own notes to create personal practice questions. AI questions are not verified by CampusIntell.'

export default async function AiPracticePage({ params }: PageProps): Promise<ReactElement> {
  const { courseId } = await params
  return <StudentAccessGate returnPath={aiPracticePath(courseId)}>
    {continuityToken => <AiPracticeCourse courseId={courseId} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

function Unavailable({ title, message }: { title: string; message: string }): ReactElement {
  return <StudentPage band={<PageBand title="Practise from your notes" lede={LEDE} />}>
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
    return <StudentPage band={<PageBand title="Practise from your notes" lede={LEDE} />}>
      <ResultNotice state="course-unavailable" retryHref={aiPracticePath(courseId)} />
    </StudentPage>
  }
  const { course } = result
  const access = await getCourseAccessForVerifiedStudent(client, [course.institutionalCourseId])
  const decision = access.status === 'ok' ? access.decisions.get(course.institutionalCourseId) : undefined
  const scoped = decision !== undefined && (decision.on_list || (decision.team_added && decision.allowed))
  // Already generated personal sets remain the owner's when course or AI access ends.
  const sets = await listPersonalSetsForCourse(client, context.user.id, course.institutionalCourseId)
  if (!scoped && sets.length === 0) redirect(STUDENT_DESTINATIONS.myCourses.href)
  const enabled = isAiPracticeAvailable()
  if (!enabled && sets.length === 0) {
    return <Unavailable title="AI practice is currently unavailable" message="You can still browse your courses for available study materials." />
  }
  // A course with verified content always sends students to it; AI practice never competes with it.
  // A locked course is built too: its page explains how to unlock it.
  if (sets.length === 0 && (isActionableStudentCourse(course) || isLockedStudentCourse(course))) redirect(course.repository.route.href)
  if (sets.length === 0 && !isAiPracticeEligible(course)) {
    return <Unavailable title="This course is temporarily unavailable" message="Try again in a few minutes." />
  }
  // AI copy names the student's own grant (a Discovery Pass, or a seven-day trial issued before it) and offers a pass
  // only when this account can still start one; a read failure stays neutral.
  const [allowance, plan] = await Promise.all([readAllowance(client),
    readEntitlementForVerifiedStudent(client).catch(() => null)])
  const trial = trialWording(plan !== null && plan.status === 'ok' ? plan.entitlement : null)
  return <StudentPage band={<PageBand title="Practise from your notes" lede={LEDE}
    context={<p className="ai-practice-context"><b>{course.code}</b> · {course.title}</p>} />}>
    <AiPracticeClient courseId={course.institutionalCourseId} continuityToken={continuityToken}
      plansOnSale={plan !== null && plan.status === 'ok' && plan.entitlement.plans_on_sale}
      initialAllowance={allowance} recentSets={sets} trial={trial}
      uploadsUnavailableReason={!scoped ? 'outside-list' : !enabled ? 'paused' : undefined}
      canGenerate={enabled && scoped && isAiPracticeEligible(course)} />
  </StudentPage>
}
