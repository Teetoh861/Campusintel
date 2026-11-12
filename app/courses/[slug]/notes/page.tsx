// app/courses/[slug]/notes/page.tsx — A course's notes as a list of topics; each topic opens on its own page.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { mixesNoteTypes, notesBlocked, resolve, topicLine } from './shared'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notes | CampusIntell', robots: { index: false, follow: false } }

export default async function NotesPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactElement> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/notes`}>
    {() => <Notes slug={slug} />}
  </StudentAccessGate>
}

async function Notes({ slug }: { slug: string }): Promise<ReactElement> {
  const result = await resolve(slug)
  const blocked = await notesBlocked(result, slug, `/courses/${slug}/notes`, 'Notes')
  if (blocked) return blocked
  if (result.status !== 'ready') return notFound()
  const { course, notes } = result
  const showType = mixesNoteTypes(notes)
  return <StudentPage band={<PageBand title="Notes" context={<p>{course.code} · {course.title}</p>}
    aside={<Link href={course.href} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>Back to course</Link>} />}>
    <ol className="student-topic-list" aria-label="Topics">
      {notes.map((note, index) => {
        const line = topicLine(note, showType)
        return <li key={note.itemId}>
          <Link href={`${course.href}/notes/${index + 1}`} prefetch={false} className="student-topic-row student-focus-control">
            <span className="student-topic-number" aria-hidden="true">{index + 1}</span>
            <span className="student-topic-text"><b>{note.title}</b>{line && <span>{line}</span>}</span>
            <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
          </Link>
        </li>
      })}
    </ol>
  </StudentPage>
}
