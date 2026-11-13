// app/courses/[slug]/notes/shared.tsx — What the notes pages share: resolving the course's notes and the page shown
// when they cannot be.
import 'server-only'
import { notFound } from 'next/navigation'
import { LockedCourseNotice } from '@/components/student/LockedCourseNotice'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { STUDY_COPY } from '@/components/student/study-families'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { buildTimeStudy } from '@/lib/courses/build-time-study'
import { readPlansOnSale } from '@/lib/entitlements/server'
import { createClient } from '@/lib/supabase/server'
import { NOTE_KICKER } from '../sections'
import { getNotesForVerifiedStudent } from './load'
import type { NotesResult } from './load'
import type { ManagedNote } from '@/lib/managed-content/student-projection'
import type { ReactElement } from 'react'

/** The line under a topic's title: its lessons, or the kind of note. */
export function topicLine(note: ManagedNote, showType: boolean): string | null {
  if (!('noteType' in note)) return null
  if (note.noteType === 'guide_topic') return note.lessons.length === 1 ? '1 lesson' : `${note.lessons.length} lessons`
  return showType ? NOTE_KICKER[note.noteType] : null
}

/** A note's type tells topics apart only when a course has more than one type (topic notes and calculator tricks). */
export function mixesNoteTypes(notes: ReadonlyArray<ManagedNote>): boolean {
  return new Set(notes.map(note => ('noteType' in note ? note.noteType : 'text'))).size > 1
}

export async function resolve(slug: string): Promise<NotesResult> {
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    return context === null ? { status: 'signed-out' } : await getNotesForVerifiedStudent(client, slug)
  } catch { return { status: 'unavailable' } }
}

/** The page for a course whose notes cannot be shown: signed out, not found, locked or unavailable. */
export async function notesBlocked(result: NotesResult, slug: string, path: string, title: string): Promise<ReactElement | null> {
  if (result.status === 'ready') return null
  if (result.status === 'not-found') return notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', path)
  if (result.status === 'locked') return <StudentPage band={<PageBand title={title} />}>
    <LockedCourseNotice outsideList={result.outsideList} reason={result.reason}
      backHref={`/courses/${encodeURIComponent(slug)}`} backLabel="Back to course"
      plansOnSale={await readPlansOnSale(await createClient()).catch(() => false)} has={buildTimeStudy(slug)} />
  </StudentPage>
  if (result.status === 'unavailable' && result.notAvailable) return <StudentPage band={<PageBand title={title} />}>
    <Notice tone="info" title={STUDY_COPY.notYetAvailable}>{null}</Notice>
  </StudentPage>
  return <StudentPage band={<PageBand title={title} />}>
    <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'} retryHref={path} />
  </StudentPage>
}
