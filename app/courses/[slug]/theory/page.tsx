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
import { createClient } from '@/lib/supabase/server'
import { theoryDisplayNumbers } from '@/lib/theory-practice/numbering'
import { getTheoryPracticeForVerifiedStudent } from '@/lib/theory-practice/published'
import { ScrollToQuestion } from './ScrollToQuestion'
import { TheoryAttempt } from './TheoryAttempt'
import type { TheoryPracticeResult } from '@/lib/theory-practice/published'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Theory practice | CampusIntell', robots: { index: false, follow: false } }

/** Gate the complete theory workspace before resolving any published content. */
export default async function TheoryPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams?: Promise<{ question?: string | string[] }>
}): Promise<ReactElement> {
  const { slug } = await params
  // A study guide topic links to its own question, which opens instead of the first.
  const requested = (await searchParams)?.question
  const question = typeof requested === 'string' ? requested : undefined
  return <StudentAccessGate returnPath={`/courses/${slug}/theory`}>
    {continuityToken => <Theory slug={slug} continuityToken={continuityToken} question={question} />}
  </StudentAccessGate>
}

async function Theory({ slug, continuityToken, question: requested }: {
  slug: string; continuityToken: string; question?: string
}): Promise<ReactElement> {
  let result: TheoryPracticeResult
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getTheoryPracticeForVerifiedStudent(client, slug)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', `/courses/${slug}/theory`)
  if (result.status === 'locked') return <StudentPage band={<PageBand title="Theory practice" />}>
    <LockedCourseNotice outsideList={result.outsideList} reason={result.reason} backHref={`/courses/${encodeURIComponent(slug)}`} backLabel="Back to course"
      plansOnSale={await readPlansOnSale(await createClient()).catch(() => false)} />
  </StudentPage>
  if (result.status === 'unavailable' && result.notAvailable) return <StudentPage band={<PageBand title="Theory practice" />}>
    <Notice tone="info" title={STUDY_COPY.notYetAvailable}>{null}</Notice>
  </StudentPage>
  if (result.status !== 'ready') return <StudentPage band={<PageBand title="Theory practice" />}>
    <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
      retryHref={`/courses/${encodeURIComponent(slug)}/theory`} />
  </StudentPage>

  const { course, materials } = result
  // Label every published question first so numbers match Course Detail, then keep only practicable ones.
  const labels = theoryDisplayNumbers(materials.map(material => material.question))
  const questions = materials.flatMap((material, index) =>
    !material.feedbackAvailable ? [] : [{ question: material.question, label: labels[index] }])
  const opened = questions.some(({ question }) => question.itemId === requested) ? requested : questions[0]?.question.itemId
  return <StudentPage band={<PageBand title="Theory practice"
    context={<p>{course.code} · {course.title}</p>}
    aside={<Link href={course.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Back to course</Link>} />}>
    <div className="student-stack min-w-0">
      {questions.length === 0 ? <Notice tone="info" title="Theory practice isn’t available for this course">
        Check the course page for theory questions to revise and other study materials.
      </Notice> : <div className="student-stack">
        {questions.map(({ question, label }) => <details key={`${question.itemId}:${question.publishedRevision}:${continuityToken}`} name="theory-practice"
          id={`question-${question.itemId}`} open={question.itemId === opened} className="student-surface min-w-0 student-anchor">
          <summary className="min-h-11 cursor-pointer rounded-ci-btn-sm py-3 font-semibold text-student-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-focus">
            Q{label} · {question.prompt}
          </summary>
          <TheoryAttempt question={question} courseSlug={course.slug} continuityToken={continuityToken} />
        </details>)}
        {requested !== undefined && opened === requested && <ScrollToQuestion id={`question-${requested}`} />}
        {materials.length > questions.length && <p className="student-meta">
          More theory questions are on the course page.
        </p>}
      </div>}
    </div>
  </StudentPage>
}
