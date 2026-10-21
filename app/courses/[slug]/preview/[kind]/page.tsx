// app/courses/[slug]/preview/[kind]/page.tsx — The Discovery Pass exam or study guide topic on a locked course.
// Loading this page never spends anything: it only reads what the database has pinned. Opening is the explicit
// OpenPreview step, and everything shown comes from the server's pinned slice, never from the full course.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent, hasActiveCourseOffering } from '@/lib/courses/read-model'
import { examSecondsFor, readDiscoveryPreview } from '@/lib/entitlements/discovery'
import { kindFromSegment, PREVIEW_SEGMENT } from '@/lib/entitlements/discovery-contract'
import { DISCOVERY_PASS_LABEL, formatAccessDate } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { NoteArticle } from '../../sections'
import { DiscoveryExam } from './DiscoveryExam'
import { OpenPreview } from './OpenPreview'
import type { DiscoveryKind, DiscoveryPreview, DiscoveryResult } from '@/lib/entitlements/discovery-contract'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ slug: string; kind: string }> }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

const TITLE: Record<DiscoveryKind, string> = { cbt: 'CBT exam', study_guide: 'Study guide topic' }

export default async function PreviewPage({ params }: PageProps): Promise<ReactElement> {
  const { slug, kind: segment } = await params
  const kind = kindFromSegment(segment)
  if (kind === null) return notFound()
  return <StudentAccessGate returnPath={`/courses/${slug}/preview/${segment}`}>
    {continuityToken => <Preview slug={slug} kind={kind} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

type CourseIdentity = { href: string; code: string; title: string; slug: string }

async function Preview({ slug, kind, continuityToken }: { slug: string; kind: DiscoveryKind; continuityToken: string }):
  Promise<ReactElement> {
  const returnPath = `/courses/${slug}/preview/${PREVIEW_SEGMENT[kind]}`
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', returnPath)
  const lookup = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (lookup.status === 'not-found') return notFound()
  if (lookup.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (lookup.status !== 'ok' && lookup.status !== 'repository-only') {
    return <StudentPage band={<PageBand title={TITLE[kind]} lede="Part of a department course, with your Discovery Pass." />}>
      <ResultNotice state="course-unavailable" retryHref={returnPath} />
    </StudentPage>
  }
  const { repository, content } = lookup.course
  const route = repository.route
  // A course the student can already read in full needs no preview.
  if (content.state !== 'locked') redirect(route.href)
  // Previews belong to courses offered now; a repository-only or retired course has none.
  if (lookup.status !== 'ok' || !hasActiveCourseOffering(lookup.course)) return notFound()
  const course: CourseIdentity = { href: route.href, slug: route.slug, code: lookup.course.code,
    title: lookup.course.title }

  const examSeconds = kind === 'cbt' ? examSecondsFor(route.slug) : null
  const [result, plan] = await Promise.all([
    readDiscoveryPreview(context.sessionId, repository.repositoryCourseId, kind, examSeconds),
    readEntitlementForVerifiedStudent(client),
  ])
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', returnPath)
  if (result.status === 'free-course' || result.status === 'full-access') redirect(route.href)
  const examQuestions = plan.status === 'ok' ? plan.entitlement.discovery?.cbt_questions ?? null : null
  const endsAt = 'endsAt' in result ? result.endsAt : null
  const band = <PageBand title={TITLE[kind]} lede={`${course.code} · ${course.title}`}
    context={endsAt !== null && <p>{DISCOVERY_PASS_LABEL} · ends {formatAccessDate(endsAt)}</p>} />
  return <StudentPage band={band}>
    <div className="grid min-w-0 max-w-3xl gap-4">
      <PreviewBody result={result} kind={kind} course={course} examQuestions={examQuestions}
        continuityToken={continuityToken} />
      <Link href={course.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface', 'justify-self-start')}>
        Back to {course.code}
      </Link>
    </div>
  </StudentPage>
}

const SECONDS_PER_MINUTE = 60

function PreviewBody({ result, kind, course, examQuestions, continuityToken }: {
  result: DiscoveryResult; kind: DiscoveryKind; course: CourseIdentity; examQuestions: number | null
  continuityToken: string
}): ReactElement {
  const plan = <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
    className={studentAction(btnNavy, studentFocusDark)}>View your plan</Link>
  switch (result.status) {
    case 'ready':
      return <Pinned preview={result.preview} now={result.now} course={course} continuityToken={continuityToken} />
    case 'available':
      if (kind === 'cbt') {
        const seconds = examSecondsFor(course.slug)
        if (seconds === null) return <NotOffered course={course} what="a CBT exam" />
        const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
        return <section className="student-surface student-surface-raised" aria-labelledby="open-title">
          <h2 id="open-title" className="student-section-title">{course.code} CBT exam</h2>
          <p className="student-detail-prose mt-2">
            {examQuestions ?? 'The'}{examQuestions !== null && '-question'} exam, timed at {minutes} minutes like the real
            CBT. The timer starts when you begin and keeps running if you leave the page. Your answers save as you go,
            and only answers saved before time runs out count. When you submit, you’ll see your score with the correct
            answers.
          </p>
          <p className="student-meta mt-2">Your pass includes one CBT exam, on the course you start it on.</p>
          <div className="mt-4">
            <OpenPreview continuityToken={continuityToken} command={{ action: 'open', courseSlug: course.slug, kind: 'cbt' }}
              label="Start the exam" />
          </div>
        </section>
      }
      if (result.topics === null || result.topics.length === 0) {
        return <NotOffered course={course} what="study guide topics" />
      }
      return <section className="student-surface student-surface-raised" aria-labelledby="topics-title">
        <h2 id="topics-title" className="student-section-title">Choose one topic</h2>
        <p className="student-meta mt-1">You can read one complete topic with your pass. The others stay locked.</p>
        <ul className="mt-4 grid gap-2">
          {result.topics.map(topic => <li key={topic.item_id}>
            <OpenPreview continuityToken={continuityToken} quiet label={topic.title}
              confirm={`Open “${topic.title}”? This is your one topic, and it can’t be changed later.`}
              command={{ action: 'open-topic', courseSlug: course.slug, itemId: topic.item_id }} />
          </li>)}
        </ul>
      </section>
    case 'not-enough-time':
      return <Notice tone="info" title="Not enough time left on your pass" action={plan}>
        The {course.code} CBT exam takes {Math.round((examSecondsFor(course.slug) ?? 0) / SECONDS_PER_MINUTE)} minutes,
        and your {DISCOVERY_PASS_LABEL} ends {formatAccessDate(result.endsAt)}. Nothing was used.
      </Notice>
    case 'used-elsewhere':
      return <Notice tone="info" title="Already used on another course" action={result.courseSlug !== null
        && <Link href={`/courses/${result.courseSlug}/preview/${PREVIEW_SEGMENT[kind]}`} prefetch={false}
          className={studentAction(btnNavy, studentFocusDark)}>Open it on {result.courseCode}</Link>}>
        Your {TITLE[kind].toLowerCase()} is on {result.courseCode ?? 'another course'}. Your pass includes one.
      </Notice>
    case 'expired':
      return <Notice tone="info" title={`Your ${DISCOVERY_PASS_LABEL} has ended`} action={plan}>
        This is no longer available. GST courses stay free.
      </Notice>
    case 'no-pass':
      return <Notice tone="info" title={`This comes with a ${DISCOVERY_PASS_LABEL}`} action={plan}>
        Start your free pass from Plan & Access to try a department course. It takes one tap.
      </Notice>
    case 'nothing-to-preview':
      return <NotOffered course={course} what={kind === 'cbt' ? 'a CBT exam' : 'study guide topics'} />
    default:
      return <Notice title="This couldn’t be loaded" action={<a href={`${course.href}/preview/${PREVIEW_SEGMENT[kind]}`}
        className={studentAction(btnGhost, 'bg-student-surface')}>Try again</a>}>Nothing was used. Please try again.</Notice>
  }
}

function NotOffered({ course, what }: { course: CourseIdentity; what: string }): ReactElement {
  return <Notice tone="info" title="Not available on this course yet">
    {course.code} doesn’t have {what} yet. Nothing was used, so you can choose another course.
  </Notice>
}

function Pinned({ preview, now, course, continuityToken }: {
  preview: DiscoveryPreview; now: string; course: CourseIdentity; continuityToken: string
}): ReactElement {
  if (preview.kind === 'cbt') {
    return <DiscoveryExam continuityToken={continuityToken} courseSlug={course.slug} questions={preview.questions}
      deadlineAt={preview.deadline_at} serverNow={now} savedSheet={preview.saved} initialResult={preview.result} />
  }
  return <>{preview.items.map(item => <NoteArticle key={item.item_id}
    note={{ itemId: item.item_id, publishedRevision: item.revision, ...item.note }} />)}
    <p className="student-meta">The other topics in {course.code} come with full access.</p>
  </>
}
