// app/courses/[slug]/campus-bot/[setId]/page.tsx — A set Campus Bot wrote from one notes topic ("Quiz me on this
// topic"), on its own page: the topic's title, then the questions one at a time on the Campus Bot set screen. The set is
// the student's own, read through their session; it stays for as long as sets are kept, so a reload or Back shows the
// same set and never asks for another.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { topicSetPath } from '@/lib/ai-practice/topic-contract'
import { readTopicSet } from '@/lib/ai-practice/topic-set-read'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { PREVIEW_SEGMENT } from '@/lib/entitlements/discovery-contract'
import { createClient } from '@/lib/supabase/server'
import { getNotesForVerifiedStudent } from '../../notes/load'
import { TopicSetPractice } from './TopicSetPractice'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Quiz | CampusIntell', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Params = { params: Promise<{ slug: string; setId: string }> }

export default async function TopicSetPage({ params }: Params): Promise<ReactElement> {
  const { slug, setId } = await params
  return <StudentAccessGate returnPath={topicSetPath(slug, setId)}>
    {() => <TopicSet slug={slug} setId={setId} />}
  </StudentAccessGate>
}

async function TopicSet({ slug, setId }: { slug: string; setId: string }): Promise<ReactElement> {
  if (!UUID.test(setId)) return notFound()
  const path = topicSetPath(slug, setId)
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', path)
  const set = await readTopicSet(client, context.user.id, setId)
  if (set === null) return notFound()
  const lookup = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (lookup.status === 'signed-out') return redirectForStudentState('signed-out', path)
  if ((lookup.status !== 'ok' && lookup.status !== 'repository-only')
    || lookup.course.repository.repositoryCourseId !== set.courseId) return notFound()
  const route = lookup.course.repository.route
  const code = lookup.status === 'ok' ? lookup.course.code : route.course.code
  // Back to the topic: its place on the notes page while this student can read the notes, the free pass's topic page
  // for a pinned topic, and otherwise the course.
  const notes = await getNotesForVerifiedStudent(client, slug).catch(() => null)
  const index = notes !== null && notes.status === 'ready'
    ? notes.notes.findIndex(note => note.itemId === set.view.topic.itemId) : -1
  const topicHref = index >= 0 ? `${route.href}/notes/${index + 1}`
    : set.pinned ? `${route.href}/preview/${PREVIEW_SEGMENT.study_guide}` : route.href
  return <StudentPage band={<PageBand title={set.view.topic.title}
    context={<p>{index >= 0 ? `${code} · Topic ${index + 1}` : code}</p>}
    aside={<Link href={topicHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
      {CAMPUS_BOT_COPY.quiz.backToTopic}</Link>} />}>
    <TopicSetPractice set={set.view} finishHref={topicHref} />
  </StudentPage>
}
