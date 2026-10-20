// app/courses/[slug]/quiz/page.tsx — Practice entry: central course truth decides whether the managed bank may launch.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { LockedCourseNotice } from '@/components/student/LockedCourseNotice'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { STUDY_COPY } from '@/components/student/study-families'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { getStudentManagedQuiz } from '@/lib/managed-content/student-quiz'
import { createClient } from '@/lib/supabase/server'
import { QuizClient } from './QuizClient'
import { PRACTICE_COPY, practiceContext } from './practice-presentation'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ slug: string }> }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

/** Cross the student account boundary before the quiz bank is read. */
export default async function QuizPage({ params }: PageProps): Promise<ReactElement> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/quiz`}>
    {continuityToken => <Quiz slug={slug} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

/** Resolve the one-course truth on a fresh request-scoped client, then the usable managed bank. */
async function Quiz({ slug, continuityToken }: { slug: string; continuityToken: string }): Promise<ReactElement> {
  const returnPath = `/courses/${slug}/quiz`
  let result: StudentCourseLookupResult
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getStudentCourseBySlugForVerifiedStudent(client, slug)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (result.status !== 'ok' && result.status !== 'repository-only') {
    return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={PRACTICE_COPY.lede} />}>
      <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
        retryHref={`/courses/${encodeURIComponent(slug)}/quiz`} />
    </StudentPage>
  }

  const { course, practice } = result
  const { route } = course.repository
  const context = practiceContext(result)
  const band = <PageBand title={PRACTICE_COPY.title} lede={context.lede} context={<p>{context.context}</p>} />
  const backToCourse = <Link href={route.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
    {PRACTICE_COPY.backToCourse}
  </Link>
  const locked = <StudentPage band={band}>
    <LockedCourseNotice backHref={route.href} backLabel={PRACTICE_COPY.backToCourse} />
  </StudentPage>
  if (course.content.state === 'locked') return locked
  if (course.content.state === 'temporarily-unavailable') {
    return <StudentPage band={band}>
      <Notice title={STUDY_COPY.temporarilyUnavailable} action={<>
        <a href={`${route.href}/quiz`} className={studentAction(btnNavy, studentFocusDark)}>Try again</a>{backToCourse}
      </>}>{PRACTICE_COPY.temporaryBody}</Notice>
    </StudentPage>
  }
  if (course.content.state !== 'ready' || !course.content.study.cbtPractice || practice === null) {
    return <StudentPage band={band}>
      <Notice tone="info" title={PRACTICE_COPY.notBuiltTitle} action={backToCourse}>{PRACTICE_COPY.notBuiltBody}</Notice>
    </StudentPage>
  }

  // The managed quiz loader owns the actual usable live bank and its attempt policy.
  const bank = await getStudentManagedQuiz(route.slug)
  if (bank.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (bank.status === 'locked') return locked
  if (bank.status !== 'ready') {
    return <StudentPage band={band}>
      <Notice title={STUDY_COPY.temporarilyUnavailable} action={<>
        <a href={`${route.href}/quiz`} className={studentAction(btnNavy, studentFocusDark)}>Try again</a>{backToCourse}
      </>}>{PRACTICE_COPY.temporaryBody}</Notice>
    </StudentPage>
  }
  return <QuizClient
    continuityToken={continuityToken}
    courseCode={context.code}
    courseTitle={context.title}
    courseSlug={route.slug}
    courseHref={route.href}
    courseContentKey={course.repository.contentKey}
    repositoryCourseId={course.repository.repositoryCourseId}
    repositoryOnly={result.status === 'repository-only'}
    sections={bank.quiz.sections}
    questions={bank.quiz.questions}
    timerSeconds={bank.quiz.timerSeconds}
    maxQuestions={bank.quiz.maxQuestions}
    totalInBank={bank.quiz.bankSize}
  />
}
