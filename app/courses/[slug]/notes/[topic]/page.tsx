// app/courses/[slug]/notes/[topic]/page.tsx — One notes topic on its own page, then the previous and next topics.
// Reading it for 30 seconds counts as opening the topic (NoteUseTracker), as on the course page before.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { CampusBotArea } from '@/components/student/CampusBotArea'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { AI_PRACTICE_LIMITS } from '@/lib/ai-practice/contract'
import { readQuizPassLine } from '@/lib/ai-practice/quiz-pass'
import { noteWords } from '@/lib/ai-practice/topic-source'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { readCampusBotFeatures } from '@/lib/campus-bot/features'
import { createClient } from '@/lib/supabase/server'
import { NoteUseTracker } from '../../NoteUseTracker'
import { NoteBody } from '../../sections'
import { AskCampusBot } from '../AskCampusBot'
import { QuizMe } from '../QuizMe'
import { theoryQuestionHref } from '../../theory/presentation'
import { notesBlocked, resolve } from '../shared'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Study guide | CampusIntell', robots: { index: false, follow: false } }

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
  const blocked = await notesBlocked(result, slug, `/courses/${slug}/notes/${topic}`, 'Study guide')
  if (blocked) return blocked
  if (result.status !== 'ready') return notFound()
  const { course, notes, practiceHref, theoryItems } = result
  const index = Number(topic) - 1
  const note = notes[index]
  if (!note) return notFound()
  const previous = notes[index - 1], next = notes[index + 1]
  const guide = 'noteType' in note && note.noteType === 'guide_topic' ? note : null
  // Ask Campus Bot about this topic, and a quiz on it, when the team has each switched on. A failed read offers nothing.
  const client = await createClient()
  const features = await readCampusBotFeatures(client).catch(() => null)
  const ask = features?.ask === true
  // A quiz needs enough notes for five fair questions; a free pass with its set unused is told it has one.
  const quiz = features?.topicSets === true && noteWords(note) >= AI_PRACTICE_LIMITS.minSourceWords
  const passLine = quiz ? await readQuizPassLine(client) : null
  const path = `/courses/${slug}/notes/${topic}`
  const signInHref = `${AUTH_PATHS.login}?next=${encodeURIComponent(path)}`
  const theoryId = guide?.theory?.itemId
  return <StudentPage band={<PageBand title={note.title}
    context={<p>{course.code} · Topic {index + 1} of {notes.length}</p>}
    aside={<Link href={`${course.href}/notes`} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>All topics</Link>} />}>
    <div id="notes" className="student-stack min-w-0">
      <article className="student-surface student-detail-note student-guide-article" data-note-item={note.itemId}>
        <NoteBody note={note} level={2} links={{
          ...(practiceHref ? { practiceHref } : {}),
          ...(theoryId && theoryItems.has(theoryId) ? { theoryHref: theoryQuestionHref(course.href, theoryId) } : {}) }} />
      </article>
      {/* Under the topic's own practice buttons: what Campus Bot does with this topic. */}
      {ask || quiz ? <CampusBotArea>
        {ask ? <AskCampusBot courseSlug={course.slug} itemId={note.itemId} topicTitle={note.title}
          continuityToken={continuityToken} signInHref={signInHref} reloadHref={path}
          offers={{ flashcards: noteWords(note) >= AI_PRACTICE_LIMITS.minSourceWords, quiz }} /> : null}
        {quiz ? <QuizMe courseSlug={course.slug} itemId={note.itemId} passLine={passLine}
          continuityToken={continuityToken} signInHref={signInHref} reloadHref={path} /> : null}
      </CampusBotArea> : null}
      <nav aria-label="Topics" className="student-guide-pager">
        {previous ? <Link href={`${course.href}/notes/${index}`} prefetch={false} className="student-topic-row student-focus-control">
          <span className="student-topic-text"><span>Previous topic</span><b>{previous.title}</b></span>
        </Link> : <span />}
        {next && <Link href={`${course.href}/notes/${index + 2}`} prefetch={false} className="student-topic-row student-focus-control">
          <span className="student-topic-text"><span>Next topic</span><b>{next.title}</b></span>
        </Link>}
      </nav>
    </div>
    <NoteUseTracker courseSlug={course.slug} continuityToken={continuityToken} />
  </StudentPage>
}
