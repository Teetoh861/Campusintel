// app/courses/[slug]/quiz/page.tsx — Practice entry. The student's own attempts come first: an attempt URL, then the
// course's open attempt, then its latest graded one, whatever the student's access or the bank is now (an attempt
// started may always finish, and its review stays the student's). Current access and a live bank decide only whether a
// fresh attempt may start.
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
import { readPracticeAttempt, readPracticeState } from '@/lib/practice/server'
import { createClient } from '@/lib/supabase/server'
import { QuizClient } from './QuizClient'
import { PRACTICE_COPY, practiceContext } from './practice-presentation'
import type { QuizInitial } from './QuizClient'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ attempt?: string | string[] }> }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

const MS_PER_MINUTE = 60_000

/** Cross the student account boundary before any practice state is read. */
export default async function QuizPage({ params, searchParams }: PageProps): Promise<ReactElement> {
  const { slug } = await params
  const { attempt } = await searchParams
  return <StudentAccessGate returnPath={`/courses/${slug}/quiz`}>
    {continuityToken => <Quiz slug={slug} continuityToken={continuityToken}
      attemptId={typeof attempt === 'string' ? attempt : null} />}
  </StudentAccessGate>
}

async function Quiz({ slug, continuityToken, attemptId }: { slug: string; continuityToken: string; attemptId: string | null }):
  Promise<ReactElement> {
  const returnPath = `/courses/${slug}/quiz`
  let result: StudentCourseLookupResult
  let sessionId: string | null = null
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    sessionId = context?.sessionId ?? null
    result = context === null ? { status: 'signed-out' } : await getStudentCourseBySlugForVerifiedStudent(client, slug)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out' || sessionId === null) return redirectForStudentState('signed-out', returnPath)
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
  const retry = () => <StudentPage band={band}>
    <Notice title={STUDY_COPY.temporarilyUnavailable} action={<>
      <a href={`${route.href}/quiz`} className={studentAction(btnNavy, studentFocusDark)}>Try again</a>{backToCourse}
    </>}>{PRACTICE_COPY.temporaryBody}</Notice>
  </StudentPage>
  // A fresh attempt may start only with current access and a live bank; the database judges both again at start.
  const brief = course.content.state === 'ready' && course.content.study.cbtPractice && practice !== null
    ? { questionCount: practice.attemptSize, durationSeconds: practice.timerSeconds } : null
  const client = (initial: QuizInitial, lastResultHref: string | null = null) => <QuizClient
    continuityToken={continuityToken} courseCode={context.code} courseTitle={context.title} courseSlug={route.slug}
    courseHref={route.href} repositoryOnly={result.status === 'repository-only'}
    repositoryCourseId={course.repository.repositoryCourseId} brief={brief} bankSize={practice?.bankSize ?? 0}
    lastResultHref={lastResultHref} initial={initial} />

  // A reloadable attempt URL: the student's own attempt on this course, open or graded.
  if (attemptId !== null) {
    const outcome = await readPracticeAttempt(sessionId, attemptId)
    if (outcome.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
    if ((outcome.status === 'ready' || outcome.status === 'graded') &&
        outcome.attempt.courseId === course.repository.repositoryCourseId) {
      return client(outcome.attempt.status === 'in_progress'
        ? { kind: 'open', attempt: outcome.attempt, now: outcome.now }
        : { kind: 'graded', attempt: outcome.attempt, latest: false })
    }
    if (outcome.status === 'unavailable') return retry()
    return <StudentPage band={band}>
      <Notice tone="info" title={PRACTICE_COPY.resultMissingTitle} action={<>
        <Link href={`${route.href}/quiz`} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>Go to practice</Link>
        {backToCourse}
      </>}>Open practice from the course page to see your attempts.</Notice>
    </StudentPage>
  }

  const state = await readPracticeState(sessionId, course.repository.repositoryCourseId)
  if (state.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (state.status === 'unavailable') return retry()
  if (state.status === 'open') {
    const left = Date.parse(state.attempt.deadlineAt) - Date.parse(state.now)
    return client({ kind: 'resume', attemptId: state.attempt.id, answered: state.attempt.answered,
      total: state.attempt.questionCount, minutesLeft: Math.max(0, Math.floor(left / MS_PER_MINUTE)) })
  }
  const lastResultHref = state.status === 'graded' ? `${route.href}/quiz?attempt=${state.attempt.id}` : null
  if (state.status === 'graded') {
    // Shown first only when this device has not shown it yet; otherwise the briefing (when a start is allowed).
    const latest = await readPracticeAttempt(sessionId, state.attempt.id)
    if (latest.status === 'graded' && latest.attempt.status !== 'in_progress') {
      return client({ kind: 'graded', attempt: latest.attempt, latest: true }, lastResultHref)
    }
  }
  if (brief !== null) return client({ kind: 'intro' }, lastResultHref)

  if (course.content.state === 'locked') {
    return <StudentPage band={band}><LockedCourseNotice outsideList={course.content.reason === 'outside-list'} backHref={route.href} backLabel={PRACTICE_COPY.backToCourse} /></StudentPage>
  }
  if (course.content.state === 'temporarily-unavailable') return retry()
  return <StudentPage band={band}>
    <Notice tone="info" title={PRACTICE_COPY.notBuiltTitle} action={backToCourse}>{PRACTICE_COPY.notBuiltBody}</Notice>
  </StudentPage>
}
