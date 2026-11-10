// app/courses/[slug]/notes/[topic]/page.tsx — One notes topic on its own page, then the previous and next topics.
// Reading it for 30 seconds counts as opening the topic (NoteUseTracker), as on the course page before.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { NoteUseTracker } from '../../NoteUseTracker'
import { NoteBody } from '../../sections'
import { theoryHref } from '../load'
import { notesBlocked, resolve } from '../shared'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notes | CampusIntell', robots: { index: false, follow: false } }

type Params = { params: Promise<{ slug: string; topic: string }> }

export default async function NotesTopicPage({ params }: Params): Promise<ReactElement> {
  const { slug, topic } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/notes/${topic}`}>
    {continuityToken => <Topic slug={slug} topic={topic} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

async function Topic({ slug, topic, continuityToken }: { slug: string; topic: string; continuityToken: string }): Promise<ReactElement> {
  if (!/^[1-9]\d{0,3}$/.test(topic)) return notFound()
  const result = await resolve(slug)
  const blocked = await notesBlocked(result, slug, `/courses/${slug}/notes/${topic}`, 'Notes')
  if (blocked) return blocked
  if (result.status !== 'ready') return notFound()
  const { course, notes, practiceHref, theoryItems } = result
  const index = Number(topic) - 1
  const note = notes[index]
  if (!note) return notFound()
  const previous = notes[index - 1], next = notes[index + 1]
  const guide = 'noteType' in note && note.noteType === 'guide_topic' ? note : null
  const theoryId = guide?.theory?.itemId
  return <StudentPage band={<PageBand title={note.title}
    context={<p>{course.code} · Topic {index + 1} of {notes.length}</p>}
    aside={<Link href={`${course.href}/notes`} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>All topics</Link>} />}>
    <div id="notes" className="student-stack min-w-0">
      <article className="student-surface student-detail-note student-guide-article" data-note-item={note.itemId}>
        <NoteBody note={note} level={2} links={{
          ...(practiceHref ? { practiceHref } : {}),
          ...(theoryId && theoryItems.has(theoryId) ? { theoryHref: theoryHref(course.href, theoryId) } : {}) }} />
      </article>
      <nav aria-label="Topics" className="student-guide-pager">
        {previous ? <Link href={`${course.href}/notes/${index}`} prefetch={false} className="student-topic-row student-focus-control">
          <ChevronLeft aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
          <span className="student-topic-text"><span>Previous topic</span><b>{previous.title}</b></span>
        </Link> : <span />}
        {next && <Link href={`${course.href}/notes/${index + 2}`} prefetch={false} className="student-topic-row student-focus-control">
          <span className="student-topic-text"><span>Next topic</span><b>{next.title}</b></span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
        </Link>}
      </nav>
    </div>
    <NoteUseTracker courseSlug={course.slug} continuityToken={continuityToken} />
  </StudentPage>
}
