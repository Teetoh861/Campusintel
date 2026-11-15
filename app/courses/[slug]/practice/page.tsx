// app/courses/[slug]/practice/page.tsx — Practise by topic: the course's topics in order, each with its count before
// practice and the student's progress after. A topic opens its practice (?topic= on the practice page); Exam mode starts
// from the course page's Practice card. A course with nothing to list here goes back to its course page.
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
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { buildTimeStudy } from '@/lib/courses/build-time-study'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { readPlansOnSale } from '@/lib/entitlements/server'
import { createClient } from '@/lib/supabase/server'
import { PRACTICE_COPY, practiceContext } from '../quiz/practice-presentation'
import { readTopicRows } from './load'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Practise by topic | CampusIntell', robots: { index: false, follow: false } }

/** Cross the student account boundary before any course or progress is read. */
export default async function PracticeTopicsPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactElement> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/practice`}>
    {() => <PracticeTopics slug={slug} />}
  </StudentAccessGate>
}

async function PracticeTopics({ slug }: { slug: string }): Promise<ReactElement> {
  const path = `/courses/${slug}/practice`
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
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', path)
  // A course that cannot be read now says so here; only a missing sign-in goes to the sign-in page.
  if ((result.status !== 'ok' && result.status !== 'repository-only') || sessionId === null || client === null) {
    return <StudentPage band={<PageBand title={PRACTICE_COPY.byTopic} />}>
      <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
        retryHref={`/courses/${encodeURIComponent(slug)}/practice`} />
    </StudentPage>
  }

  const { course, practice } = result
  const { route, repositoryCourseId } = course.repository
  const context = <p>{practiceContext(result).context}</p>
  const backToCourse = <Link href={route.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
    {PRACTICE_COPY.backToCourse}
  </Link>
  const retry = <StudentPage band={<PageBand title={PRACTICE_COPY.byTopic} context={context} />}>
    <Notice title={PRACTICE_COPY.topicsFailedTitle} action={<>
      <a href={`${route.href}/practice`} className={studentAction(btnNavy, studentFocusDark)}>{PRACTICE_COPY.tryAgain}</a>
      {backToCourse}
    </>} />
  </StudentPage>
  if (course.content.state === 'locked') {
    return <StudentPage band={<PageBand title={PRACTICE_COPY.byTopic} context={context} />}>
      <LockedCourseNotice reason={course.content.reason} backHref={route.href} backLabel={PRACTICE_COPY.backToCourse}
        plansOnSale={await readPlansOnSale(client).catch(() => false)} has={buildTimeStudy(route.slug)} />
    </StudentPage>
  }
  if (course.content.state === 'temporarily-unavailable') return retry
  // No practice to list topics for: the course page says what this course has.
  if (course.content.state !== 'ready' || !course.content.study.cbtPractice || practice === null) redirect(route.href)

  const topics = await readTopicRows(client, sessionId, { slug: route.slug, repositoryCourseId })
  if (topics === null) return retry
  // A course without topics practises in Exam mode, which starts from the course page's Practice card.
  if (topics.length === 0) redirect(`${route.href}#cbtPractice`)
  return <StudentPage band={<PageBand title={PRACTICE_COPY.byTopic} context={context} aside={backToCourse} />}>
    <ol className="student-topic-list" aria-label="Topics">
      {topics.map(row => <li key={row.topic}>
        <Link href={`${practice.href}?topic=${encodeURIComponent(row.topic)}`} prefetch={false}
          className="student-topic-row student-focus-control">
          <span className="student-topic-number" aria-hidden="true">{row.number}</span>
          <span className="student-topic-text"><b>{row.topic}</b><span>{row.line}</span></span>
        </Link>
      </li>)}
    </ol>
  </StudentPage>
}
