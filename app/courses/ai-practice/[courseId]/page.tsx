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
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseByIdForVerifiedStudent, isActionableStudentCourse, isLockedStudentCourse }
  from '@/lib/courses/read-model'
import { discoveryOffered } from '@/lib/entitlements/contract'
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
  if (!isAiPracticeAvailable()) {
    return <Unavailable title="AI practice is currently unavailable" message="You can still browse your courses for available study materials." />
  }
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
  // A course with verified content always sends students to it; AI practice never competes with it.
  // A locked course is built too: its page explains how to unlock it.
  if (isActionableStudentCourse(course) || isLockedStudentCourse(course)) redirect(course.repository.route.href)
  if (!isAiPracticeEligible(course)) {
    return <Unavailable title="This course is temporarily unavailable" message="Try again in a few minutes." />
  }
  // The pass is named in AI copy only when the database offers one; a read failure stays neutral.
  const [allowance, sets, plan] = await Promise.all([readAllowance(client),
    listPersonalSetsForCourse(client, context.user.id, course.institutionalCourseId),
    readEntitlementForVerifiedStudent(client).catch(() => null)])
  const passOffered = plan !== null && plan.status === 'ok' && discoveryOffered(plan.entitlement)
  return <StudentPage band={<PageBand title="Practise from your notes" lede={LEDE}
    context={<p className="ai-practice-context"><b>{course.code}</b> · {course.title}</p>} />}>
    <AiPracticeClient courseId={course.institutionalCourseId} continuityToken={continuityToken}
      initialAllowance={allowance} recentSets={sets} passOffered={passOffered} />
  </StudentPage>
}
