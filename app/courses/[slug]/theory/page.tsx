import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
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
const LEDE = 'Write an answer, compare it with the published model answer, then assess it yourself.'

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
        You decide how well your answer covers the published material. Scores are your own assessment and are not verified or AI graded.
        Your written answers and reflections stay on this page only. They are never sent to CampusIntell and are not saved to attempt history.
      </Notice>
      {questions.length === 0 ? <Notice tone="info" title="Theory practice is not yet available">
        A published theory question and its model answer are needed to practise. Check the course page for other study materials.
      </Notice> : <div className="student-stack">
        <p className="student-meta">Choose a question. The model answer and any authored rubric appear after you submit, even if your answer is blank.</p>
        {questions.map(({ question, label }, index) => <details key={`${question.itemId}:${question.publishedRevision}:${continuityToken}`} name="theory-practice"
          open={index === 0} className="student-surface min-w-0">
          <summary className="min-h-11 cursor-pointer rounded-ci-btn-sm py-3 font-semibold text-student-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-focus">
            Q{label} · {question.prompt}
          </summary>
          <TheoryAttempt question={question} courseSlug={course.slug} continuityToken={continuityToken} />
        </details>)}
        {materials.length > questions.length && <p className="student-meta">
          Other theory questions are available to read on the course page. Their model answers have not been published for practice yet.
        </p>}
      </div>}
    </div>
  </StudentPage>
}
