// app/courses/[slug]/page.tsx — Account-gated Course Detail study hub composed from central one-course truth.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { STUDY_COPY } from '@/components/student/study-families'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { courses } from '@/lib/data/courses'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { BookmarkButton } from './BookmarkButton'
import { CourseViewTracker } from './CourseViewTracker'
import { ApplicabilityList, COURSE_LEDE, NotesSection, OverviewSection, PracticeSection, ReadingList,
  StudyNav, TheorySection, studySections } from './sections'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { StudySectionId } from './sections'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ slug: string }> }
type ResolvedCourse = Extract<StudentCourseLookupResult, { status: 'ok' | 'repository-only' }>

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

// Legacy local bookmark aliases only; course identity never comes from this list.
const BOOKMARK_CATALOG = courses.map(({ slug, code, contentKey }) => ({ slug, code, contentKey }))

/** Cross the student account boundary before any course content is read. */
export default async function CourseDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}`}><CourseDetail slug={slug} /></StudentAccessGate>
}

/** Resolve the one-course truth on a fresh request-scoped client after the gate. */
async function CourseDetail({ slug }: { slug: string }): Promise<ReactElement> {
  let result: StudentCourseLookupResult
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getStudentCourseBySlugForVerifiedStudent(client, slug)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'ok' || result.status === 'repository-only') return <CourseStudyHub result={result} />
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', `/courses/${slug}`)
  return <CourseUnavailable status={result.status} slug={slug} />
}

/** Fail closed without any unverified course identity. */
function CourseUnavailable({ status, slug }: { status: 'unavailable' | 'invariant-failure'; slug: string }): ReactElement {
  return <StudentPage band={<PageBand title="Course" lede={COURSE_LEDE} />}>
    <ResultNotice state={status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
      retryHref={`/courses/${encodeURIComponent(slug)}`}
      extra={status === 'unavailable' && <Link href={STUDENT_DESTINATIONS.materials.href} prefetch={false}
        className={studentAction(btnGhost, 'bg-student-surface')}>{STUDENT_DESTINATIONS.materials.label}</Link>} />
  </StudentPage>
}

function RequestMaterialLink({ href, prominent = false }: { href: string; prominent?: boolean }): ReactElement {
  return <Link href={href} prefetch={false}
    className={prominent ? studentAction(btnNavy, studentFocusDark) : studentAction(btnGhost, 'bg-student-surface')}>
    Request material{prominent && <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />}
  </Link>
}

/** Compose institutional or repository identity, availability and the study families from central truth. */
function CourseStudyHub({ result }: { result: ResolvedCourse }): ReactElement {
  const { learning, practice } = result
  const { repository, content } = result.course
  const institutional = result.status === 'ok' ? result.course : null
  const { route } = repository
  const code = institutional?.code ?? route.course.code
  const title = institutional?.title ?? route.course.title
  const materialsHref = `${route.href}/materials`
  const sections = studySections({
    study: content.state === 'ready' ? content.study : null,
    learning, practice, textbooks: route.course.textbooks.length,
  })
  const contents = sections.length >= 2
  const number = (id: StudySectionId) => sections.indexOf(id) + 1
  return <StudentPage workspaceClassName="student-detail-workspace" band={<>
    <CourseViewTracker courseSlug={route.slug} />
    <PageBand title={title} lede={COURSE_LEDE}
      context={<p>{institutional ? <>{code}{institutional.isFree && ' · Free'}</> : <>Repository course · {code}</>}</p>}
      aside={<div className="student-band-actions">
        {content.state === 'ready' ? <RequestMaterialLink href={materialsHref} /> : <span />}
        <BookmarkButton slug={route.slug} code={route.course.code} contentKey={repository.contentKey} catalog={BOOKMARK_CATALOG} />
      </div>} />
  </>}>
    {contents && <aside className="student-detail-rail"><StudyNav sections={sections} /></aside>}
    <div className="student-detail-reading">
      {institutional
        ? <section aria-labelledby="applicability-title" className="student-detail-section">
          <h2 id="applicability-title" className="student-section-title">Confirmed for</h2>
          <ApplicabilityList applicability={institutional.applicability} />
        </section>
        : <Notice tone="info" title="Repository course">
          Institutional applicability has not been confirmed for this course. The study content below is published repository material.
        </Notice>}
      {content.state === 'temporarily-unavailable' && <Notice title={STUDY_COPY.temporarilyUnavailable} action={<>
        <a href={route.href} className={studentAction(btnGhost, 'bg-student-surface')}>Try again</a>
        <RequestMaterialLink href={materialsHref} />
      </>}>We couldn’t load the published study content for this course just now.</Notice>}
      {content.state === 'no-published-learning' && <Notice tone="info" title={STUDY_COPY.notYetAvailable}
        action={<RequestMaterialLink href={materialsHref} prominent />}>
        CampusIntell hasn’t published notes, CBT practice or theory questions for this course yet.
      </Notice>}
      {sections.includes('notes') && learning && <NotesSection notes={learning.notes} number={number('notes')} />}
      {sections.includes('cbtPractice') && practice && <PracticeSection practice={practice} number={number('cbtPractice')} />}
      {sections.includes('theory') && learning && <TheorySection items={learning.theoryQuestions} number={number('theory')} />}
      {sections.includes('overview') && learning?.overview && <OverviewSection overview={learning.overview} number={number('overview')} />}
      {sections.includes('reading') && <ReadingList textbooks={route.course.textbooks} number={number('reading')} />}
    </div>
  </StudentPage>
}
