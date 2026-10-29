// app/courses/[slug]/quiz/page.tsx — Practice entry. The student's own attempts come first: an attempt URL, then the
// course's open attempt, whatever the student's access or the bank is now (an attempt started may always finish, and
// its review stays the student's). Then ?topic= starts instant feedback on that topic and ?mode=exam opens the exam
// (its latest unseen result first, then its brief); anything else goes back to the course's topic list. Current access
// and a live bank decide only whether a fresh attempt may start.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
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
import { practicePolicyFor, readPracticeAttempt, readPracticeState } from '@/lib/practice/server'
import { readPracticeTopics } from '@/lib/practice/topics'
import { createClient } from '@/lib/supabase/server'
import { QuizClient } from './QuizClient'
import { PRACTICE_COPY, attemptHref, practiceContext } from './practice-presentation'
import type { QuizInitial } from './QuizClient'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

type Search = { attempt?: string | string[]; topic?: string | string[]; mode?: string | string[] }
type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<Search> }
type Entry = { attemptId: string | null; topic: string | null; exam: boolean }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

const MS_PER_MINUTE = 60_000

/** Cross the student account boundary before any practice state is read. */
export default async function QuizPage({ params, searchParams }: PageProps): Promise<ReactElement> {
  const { slug } = await params
  const { attempt, topic, mode } = await searchParams
  const entry = { attemptId: typeof attempt === 'string' ? attempt : null,
    topic: typeof topic === 'string' && topic.trim() !== '' ? topic.trim() : null, exam: mode === 'exam' }
  return <StudentAccessGate returnPath={`/courses/${slug}/quiz`}>
    {continuityToken => <Quiz slug={slug} continuityToken={continuityToken} entry={entry} />}
  </StudentAccessGate>
}

async function Quiz({ slug, continuityToken, entry }: { slug: string; continuityToken: string; entry: Entry }):
  Promise<ReactElement> {
  const { attemptId } = entry
  const returnPath = `/courses/${slug}/quiz`
  let result: StudentCourseLookupResult
  let sessionId: string | null = null
  let client: Awaited<ReturnType<typeof createClient>> | null = null
  try {
    client = await createClient()
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
  // The course's topics in order, for an instant attempt's Next topic; none when they cannot be read now.
  const topicsFor = async (): Promise<string[]> => {
    try {
      const policy = practicePolicyFor(route.slug)
      if (client === null || policy === null) return []
      return (await readPracticeTopics(client, course.repository.repositoryCourseId, policy.sections) ?? [])
        .map(entry => entry.topic)
    } catch { return [] }
  }
  const quiz = async (initial: QuizInitial, lastResultHref: string | null = null) => <QuizClient
    continuityToken={continuityToken} courseCode={context.code} courseTitle={context.title} courseSlug={route.slug}
    courseHref={route.href} repositoryOnly={result.status === 'repository-only'}
    repositoryCourseId={course.repository.repositoryCourseId} brief={brief} bankSize={practice?.bankSize ?? 0}
    topics={initial.kind === 'topic' || ('attempt' in initial && initial.attempt.mode === 'instant') ? await topicsFor() : []}
    lastResultHref={lastResultHref} initial={initial} />

  // A reloadable attempt URL: the student's own attempt on this course, open or graded.
  if (attemptId !== null) {
    const outcome = await readPracticeAttempt(sessionId, attemptId)
    if (outcome.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
    if ((outcome.status === 'ready' || outcome.status === 'graded') &&
        outcome.attempt.courseId === course.repository.repositoryCourseId) {
      return await quiz(outcome.attempt.status === 'in_progress'
        ? { kind: 'open', attempt: outcome.attempt, now: outcome.now }
        : { kind: 'graded', attempt: outcome.attempt, latest: false })
    }
    if (outcome.status === 'unavailable') return retry()
    return <StudentPage band={band}>
      <Notice tone="info" title={PRACTICE_COPY.resultMissingTitle} action={<>
        <Link href={`${route.href}#cbtPractice`} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>Go to practice</Link>
        {backToCourse}
      </>}>Open practice from the course page to see your attempts.</Notice>
    </StudentPage>
  }

  const state = await readPracticeState(sessionId, course.repository.repositoryCourseId)
  if (state.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (state.status === 'unavailable') return retry()
  // An open instant attempt has no clock to show: it reopens on its next unanswered question.
  if (state.status === 'open' && state.attempt.mode === 'instant') {
    const open = await readPracticeAttempt(sessionId, state.attempt.id)
    if (open.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
    if (open.status === 'ready' && open.attempt.status === 'in_progress') {
      // Another topic chosen: its start closes this run (the database keeps its picks and score).
      if (entry.topic !== null && entry.topic !== open.attempt.topic && brief !== null) {
        return await quiz({ kind: 'topic', topic: entry.topic })
      }
      return await quiz({ kind: 'open', attempt: open.attempt, now: open.now })
    }
    if (open.status === 'graded' && open.attempt.status !== 'in_progress') {
      return await quiz({ kind: 'graded', attempt: open.attempt, latest: true })
    }
    return retry()
  }
  // Practice waits while an exam is open in this course, so no answer is marked during it.
  if (state.status === 'open' && entry.topic !== null) {
    return <StudentPage band={band}>
      <Notice tone="info" title={PRACTICE_COPY.examOpenTitle} action={<>
        <Link href={attemptHref(route.href, state.attempt.id)} prefetch={false}
          className={studentAction(btnNavy, studentFocusDark)}>{PRACTICE_COPY.resumeExam}</Link>
        {backToCourse}
      </>}>{PRACTICE_COPY.examOpenBody}</Notice>
    </StudentPage>
  }
  if (state.status === 'open') {
    const left = Date.parse(state.attempt.deadlineAt) - Date.parse(state.now)
    return await quiz({ kind: 'resume', attemptId: state.attempt.id, answered: state.attempt.answered,
      total: state.attempt.questionCount, minutesLeft: Math.max(0, Math.floor(left / MS_PER_MINUTE)) })
  }
  // Practice starts from the course's topic list, or from its Exam mode button.
  if (entry.topic === null && !entry.exam) redirect(`${route.href}#cbtPractice`)
  if (entry.topic !== null) {
    if (brief !== null) return await quiz({ kind: 'topic', topic: entry.topic })
  } else {
    const lastExam = state.status === 'graded' && state.attempt.mode === 'exam' ? state.attempt.id : null
    const lastResultHref = lastExam === null ? null : `${route.href}/quiz?attempt=${lastExam}`
    if (lastExam !== null) {
      // Shown first only when this device has not shown it yet; otherwise the briefing (when a start is allowed).
      const latest = await readPracticeAttempt(sessionId, lastExam)
      if (latest.status === 'graded' && latest.attempt.status !== 'in_progress') {
        return await quiz({ kind: 'graded', attempt: latest.attempt, latest: true }, lastResultHref)
      }
    }
    if (brief !== null) return await quiz({ kind: 'intro' }, lastResultHref)
  }

  if (course.content.state === 'locked') {
    return <StudentPage band={band}><LockedCourseNotice backHref={route.href} backLabel={PRACTICE_COPY.backToCourse} /></StudentPage>
  }
  if (course.content.state === 'temporarily-unavailable') return retry()
  return <StudentPage band={band}>
    <Notice tone="info" title={PRACTICE_COPY.notBuiltTitle} action={backToCourse}>{PRACTICE_COPY.notBuiltBody}</Notice>
  </StudentPage>
}
