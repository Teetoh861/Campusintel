import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { LockedCourseNotice } from '@/components/student/LockedCourseNotice'
import { readPlansOnSale } from '@/lib/entitlements/server'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { STUDY_COPY } from '@/components/student/study-families'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { buildTimeStudy } from '@/lib/courses/build-time-study'
import { createClient } from '@/lib/supabase/server'
import { getTheoryPracticeForVerifiedStudent } from '@/lib/theory-practice/published'
import { TheoryPractice } from './TheoryPractice'
import type { TheoryPracticeResult } from '@/lib/theory-practice/published'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Theory practice | CampusIntell', robots: { index: false, follow: false } }

/** Gate the complete theory workspace before resolving any published content. */
export default async function TheoryPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactElement> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/theory`}>
    {continuityToken => <Theory slug={slug} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

async function Theory({ slug, continuityToken }: { slug: string; continuityToken: string }): Promise<ReactElement> {
  let result: TheoryPracticeResult
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getTheoryPracticeForVerifiedStudent(client, slug)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', `/courses/${slug}/theory`)
  if (result.status === 'locked') return <StudentPage band={<PageBand title="Theory practice"
    context={<p>{result.course.code} · {result.course.title}</p>} />}>
    <LockedCourseNotice outsideList={result.outsideList} reason={result.reason} backHref={`/courses/${encodeURIComponent(slug)}`} backLabel="Back to course"
      plansOnSale={await readPlansOnSale(await createClient()).catch(() => false)} has={buildTimeStudy(result.course.slug)} />
  </StudentPage>
  if (result.status === 'unavailable' && result.notAvailable) return <StudentPage band={<PageBand title="Theory practice" />}>
    <Notice tone="info" title={STUDY_COPY.notYetAvailable}>{null}</Notice>
  </StudentPage>
  if (result.status !== 'ready') return <StudentPage band={<PageBand title="Theory practice" />}>
    <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
      retryHref={`/courses/${encodeURIComponent(slug)}/theory`} />
  </StudentPage>

  const { course, materials } = result
  // Every published question, in the published order: one with a suggested answer is practised, one without is read.
  return <StudentPage band={<PageBand title="Theory practice"
    context={<p>{course.code} · {course.title}</p>}
    aside={<Link href={course.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Back to course</Link>} />}>
    {materials.length === 0 ? <Notice tone="info" title="Theory practice isn’t available for this course" />
      : <TheoryPractice courseSlug={course.slug} continuityToken={continuityToken}
        questions={materials.map(({ question, feedbackAvailable }) => ({ question, practicable: feedbackAvailable }))} />}
  </StudentPage>
}
