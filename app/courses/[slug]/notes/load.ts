// app/courses/[slug]/notes/load.ts — Resolve a course's published notes for the notes pages, behind the same course
// access as the course page.
import 'server-only'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import type { CourseLockReason } from '@/lib/courses/read-model'
import type { ManagedNote } from '@/lib/managed-content/student-projection'
import type { createClient } from '@/lib/supabase/server'

export type NotesCourse = { slug: string; href: string; code: string; title: string }
export type NotesResult =
  | { status: 'ready'; course: NotesCourse; notes: ManagedNote[]
      // This course's practice, when the student can open it; guide topics link their practice topics to it.
      practiceHref: string | null
      // Theory questions the theory page can practise, by item id.
      theoryItems: ReadonlySet<string> }
  | { status: 'locked'; outsideList?: boolean; reason?: CourseLockReason }
  | { status: 'unavailable'; notAvailable?: true }
  | { status: 'signed-out' | 'not-found' | 'invariant-failure' }

export async function getNotesForVerifiedStudent(client: Awaited<ReturnType<typeof createClient>>, slug: string): Promise<NotesResult> {
  const result = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (result.status !== 'ok' && result.status !== 'repository-only') return result
  const { content, repository } = result.course
  if (content.state === 'locked') return { status: 'locked',
    ...(content.reason === 'outside-list' ? { outsideList: true } : {}), ...(content.reason ? { reason: content.reason } : {}) }
  if (content.state === 'temporarily-unavailable') return { status: 'unavailable' }
  if (content.state !== 'ready' || result.learning === null || result.learning.notes.length === 0) {
    return { status: 'unavailable', notAvailable: true }
  }
  const { route } = repository
  const learning = result.learning
  return { status: 'ready',
    course: { slug: route.slug, href: route.href,
      code: result.status === 'ok' ? result.course.code : route.course.code,
      title: result.status === 'ok' ? result.course.title : route.course.title },
    notes: learning.notes,
    practiceHref: content.study.cbtPractice && result.practice !== null ? result.practice.href : null,
    theoryItems: new Set(learning.theoryPractice ? learning.theoryQuestions.map(question => question.itemId) : []) }
}

/** Where a guide topic's theory question is practised: the theory page, opened at that question. */
export const theoryHref = (courseHref: string, itemId: string) =>
  `${courseHref}/theory?question=${encodeURIComponent(itemId)}#question-${itemId}`
