// app/courses/[slug]/page.tsx — Account-gated Course Detail study hub composed from central one-course truth.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { DiscoveryOffer } from '@/components/student/DiscoveryOffer'
import { LockedCourseNotice } from '@/components/student/LockedCourseNotice'
import { Notice } from '@/components/student/Notice'
import { REPOSITORY_COURSE_LABEL } from '@/components/student/CourseRow'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { STUDY_COPY } from '@/components/student/study-families'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { buildTimeStudy } from '@/lib/courses/build-time-study'
import { getStudentCourseBySlugForVerifiedStudent, hasActiveCourseOffering } from '@/lib/courses/read-model'
import { courses } from '@/lib/data/courses'
import { discoveryOffered } from '@/lib/entitlements/contract'
import { trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent, readPlansOnSale } from '@/lib/entitlements/server'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { BookmarkButton } from './BookmarkButton'
import { CourseViewTracker } from './CourseViewTracker'
import { readTopicRows } from './practice/load'
import { NotesCard, OverviewSection, PracticeCard, ReadingList, StudyNav, TheoryCard, studySections } from './sections'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { DiscoveryPass } from '@/components/student/DiscoveryOffer'
import type { PracticeTopicRow } from '@/lib/practice/topics'
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
  return <StudentAccessGate returnPath={`/courses/${slug}`}>
    {continuityToken => <CourseDetail slug={slug} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

/** Resolve the one-course truth on a fresh request-scoped client after the gate. */
async function CourseDetail({ slug, continuityToken }: { slug: string; continuityToken: string }): Promise<ReactElement> {
  let result: StudentCourseLookupResult
  // Read only for a locked course that is offered now: an active Discovery Pass offers previews in place of the locked
  // notice. Repository-only and retired courses have no previews.
  let pass: DiscoveryPass | null = null
  // Mentioned only when this account can still start a pass: the database offers one (a database from before the
  // pass offers none) and the account has not had its one trial.
  let passHours: number | null = null
  // The copy switch for the lock notice (plans_on_sale), read only for a locked course.
  let plansOnSale = false
  // The course's practice topics with this student's progress. A topic read that fails leaves Exam mode only, never the
  // page unavailable.
  let topics: PracticeTopicRow[] = []
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getStudentCourseBySlugForVerifiedStudent(client, slug)
    if (result.status === 'ok' && result.course.content.state === 'locked' && result.course.content.reason === undefined && hasActiveCourseOffering(result.course)) {
      const read = await readEntitlementForVerifiedStudent(client)
      const entitlement = read.status === 'ok' ? read.entitlement : null
      passHours = entitlement !== null && trialWording(entitlement).passAvailable ? entitlement.trial_hours : null
      pass = discoveryOffered(entitlement) && entitlement.trial.status === 'active' && entitlement.trial.policy === 'discovery'
        ? { discovery: entitlement.discovery, endsAt: entitlement.trial.ends_at } : null
    }
    if ((result.status === 'ok' || result.status === 'repository-only') && result.course.content.state === 'locked') {
      plansOnSale = await readPlansOnSale(client)
    }
    if (context !== null && (result.status === 'ok' || result.status === 'repository-only') && result.practice !== null) {
      const { repositoryCourseId, route } = result.course.repository
      topics = await readTopicRows(client, context.sessionId, { slug: route.slug, repositoryCourseId }) ?? []
    }
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'ok' || result.status === 'repository-only') {
    return <CourseStudyHub result={result} pass={pass} passHours={passHours} topics={topics}
      continuityToken={continuityToken} plansOnSale={plansOnSale} />
  }
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', `/courses/${slug}`)
  return <CourseUnavailable status={result.status} slug={slug} />
}

/** Fail closed without any unverified course identity. */
function CourseUnavailable({ status, slug }: { status: 'unavailable' | 'invariant-failure'; slug: string }): ReactElement {
  return <StudentPage band={<PageBand title="Course" />}>
    <ResultNotice state={status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
      retryHref={`/courses/${encodeURIComponent(slug)}`}
      extra={status === 'unavailable' && <Link href={STUDENT_DESTINATIONS.materials.href} prefetch={false}
        className={studentAction(btnGhost, 'bg-student-surface')}>{STUDENT_DESTINATIONS.materials.label}</Link>} />
  </StudentPage>
}

function RequestMaterialLink({ href, prominent = false }: { href: string; prominent?: boolean }): ReactElement {
  return <Link href={href} prefetch={false}
    className={prominent ? studentAction(btnNavy, studentFocusDark) : studentAction(btnGhost, 'bg-student-surface')}>
    Request material
  </Link>
}

/** Compose institutional or repository identity, availability and the study families from central truth. */
function CourseStudyHub({ result, pass, passHours, topics, continuityToken, plansOnSale }: {
  result: ResolvedCourse; pass: DiscoveryPass | null; passHours: number | null; topics: ReadonlyArray<PracticeTopicRow>
  continuityToken: string; plansOnSale: boolean
}): ReactElement {
  const { learning, practice } = result
  const { repository, content } = result.course
  const institutional = result.status === 'ok' ? result.course : null
  const { route } = repository
  const code = institutional?.code ?? route.course.code
  const title = institutional?.title ?? route.course.title
  const materialsHref = `${route.href}/materials`
  const locked = content.state === 'locked'
  const scopeNotice = content.state === 'locked' && content.reason !== undefined
  const study = content.state === 'ready' ? content.study : null
  const sections = locked || content.state === 'not-available' ? [] : studySections({
    study, learning, practice, textbooks: route.course.textbooks.length,
  })
  const contents = sections.length >= 2
  const number = (id: StudySectionId) => sections.indexOf(id) + 1
  return <StudentPage workspaceClassName="student-detail-workspace" band={<>
    <CourseViewTracker courseSlug={route.slug} />
    <PageBand title={title}
      context={<p>{institutional ? <>{code}{institutional.isFree && ' · Free'}</> : <>{REPOSITORY_COURSE_LABEL} · {code}</>}</p>}
      aside={<div className="student-band-actions">
        {content.state === 'ready' ? <RequestMaterialLink href={materialsHref} /> : <span />}
        <BookmarkButton slug={route.slug} code={route.course.code} contentKey={repository.contentKey} catalog={BOOKMARK_CATALOG} />
      </div>} />
  </>}>
    {contents && <aside className="student-detail-rail"><StudyNav sections={sections} /></aside>}
    <div className="student-detail-reading">
      {!institutional && content.state !== 'not-available' && <Notice tone="info" title={REPOSITORY_COURSE_LABEL}>
          Check it against your course outline.
        </Notice>}
      {locked && (scopeNotice || pass === null ? <LockedCourseNotice passHours={passHours} reason={content.reason}
        plansOnSale={plansOnSale} has={buildTimeStudy(route.slug)} />
        : <DiscoveryOffer pass={pass} contentKey={repository.contentKey} courseHref={route.href} />)}
      {content.state === 'temporarily-unavailable' && <Notice title={STUDY_COPY.temporarilyUnavailable} action={<>
        <a href={route.href} className={studentAction(btnGhost, 'bg-student-surface')}>Try again</a>
        <RequestMaterialLink href={materialsHref} />
      </>} />}
      {content.state === 'not-available' && <Notice tone="info" title={STUDY_COPY.notYetAvailable}>{null}</Notice>}
      {content.state === 'no-published-learning' && <Notice tone="info" title={STUDY_COPY.notYetAvailable}
        action={<RequestMaterialLink href={materialsHref} prominent />}>
        Notes, CBT practice and theory questions are not available for this course. You can request study material below.
      </Notice>}
      {sections.includes('notes') && learning && <NotesCard notes={learning.notes} href={`${route.href}/notes`}
        number={number('notes')} />}
      {sections.includes('cbtPractice') && practice && <PracticeCard practice={practice} topics={topics}
        topicsHref={`${route.href}/practice`} number={number('cbtPractice')} />}
      {sections.includes('theory') && learning && <TheoryCard questions={learning.theoryQuestions.length}
        href={`${route.href}/theory`} number={number('theory')} />}
      {sections.includes('overview') && learning?.overview && <OverviewSection overview={learning.overview}
        number={number('overview')} />}
      {sections.includes('reading') && <ReadingList textbooks={route.course.textbooks} number={number('reading')} />}
    </div>
  </StudentPage>
}
