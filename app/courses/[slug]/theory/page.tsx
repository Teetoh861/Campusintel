import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { LockedCourseNotice } from '@/components/student/LockedCourseNotice'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { theoryDisplayNumbers } from '@/lib/theory-practice/numbering'
import { getTheoryPracticeForVerifiedStudent } from '@/lib/theory-practice/published'
import { TheoryAttempt } from './TheoryAttempt'
import type { TheoryPracticeResult } from '@/lib/theory-practice/published'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Theory practice | CampusIntell', robots: { index: false, follow: false } }
const LEDE = 'Write an answer, compare it with the model answer, then assess it yourself.'

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
  if (result.status === 'locked') return <StudentPage band={<PageBand title="Theory practice" lede={LEDE} />}>
    <LockedCourseNotice backHref={`/courses/${encodeURIComponent(slug)}`} backLabel="Back to course" />
  </StudentPage>
  if (result.status !== 'ready') return <StudentPage band={<PageBand title="Theory practice" lede={LEDE} />}>
    <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
      retryHref={`/courses/${encodeURIComponent(slug)}/theory`} />
  </StudentPage>

  const { course, materials } = result
  // Label every published question first so numbers match Course Detail, then keep only practicable ones.
  const labels = theoryDisplayNumbers(materials.map(material => material.question))
  const questions = materials.flatMap((material, index) =>
    material.feedback === null ? [] : [{ question: material.question, label: labels[index] }])
  return <StudentPage band={<PageBand title="Theory practice" lede={LEDE}
    context={<p>{course.code} · {course.title}</p>}
    aside={<Link href={course.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Back to course</Link>} />}>
    <div className="student-stack min-w-0">
      <Notice tone="info" title="Student self-assessment">
        Compare your answer with the model answer and assess how well you covered the key points. Your self-assessment is not verified or graded by AI.
        Your written answers and reflections stay on this page only. They are never sent to CampusIntell and are not saved to attempt history.
      </Notice>
      {questions.length === 0 ? <Notice tone="info" title="Theory practice is not available for this course">
        You can’t compare answers for this course right now. Check the course page for theory questions to revise or other study materials.
      </Notice> : <div className="student-stack">
        <p className="student-meta">Choose a question. After you submit, you’ll see the model answer and a marking guide where available. You can also submit a blank answer to compare.</p>
        {questions.map(({ question, label }, index) => <details key={`${question.itemId}:${question.publishedRevision}:${continuityToken}`} name="theory-practice"
          open={index === 0} className="student-surface min-w-0">
          <summary className="min-h-11 cursor-pointer rounded-ci-btn-sm py-3 font-semibold text-student-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-focus">
            Q{label} · {question.prompt}
          </summary>
          <TheoryAttempt question={question} courseSlug={course.slug} continuityToken={continuityToken} />
        </details>)}
        {materials.length > questions.length && <p className="student-meta">
          You can revise more theory questions on the course page. Model answers are not available for those questions.
        </p>}
      </div>}
    </div>
  </StudentPage>
}
