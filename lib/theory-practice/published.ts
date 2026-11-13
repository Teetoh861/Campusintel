import 'server-only'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { getPublishedManagedContentWithVerifiedClient } from '@/lib/managed-content/published'
import { projectTheoryPractice } from './projection'
import type { CourseLockReason } from '@/lib/courses/read-model'
import type { createClient } from '@/lib/supabase/server'
import type { TheoryMaterial } from './projection'

export type TheoryPracticeResult =
  | { status: 'ready'; course: { slug: string; href: string; code: string; title: string; repositoryCourseId: string };
      materials: TheoryMaterial[] }
  | { status: 'locked'; course: { slug: string; code: string; title: string }; outsideList?: boolean; reason?: CourseLockReason }
  | { status: 'unavailable'; notAvailable?: true }
  | { status: 'signed-out' | 'not-found' | 'invariant-failure' }

/** Resolve central course identity, then reread published theory on the same verified cookie-bound client. */
export async function getTheoryPracticeForVerifiedStudent(
  client: Awaited<ReturnType<typeof createClient>>, slug: string,
): Promise<TheoryPracticeResult> {
  const course = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (course.status !== 'ok' && course.status !== 'repository-only') return course
  const repository = course.course.repository
  // Identity only: the institutional code and title, or the shelf's for a repository-only course.
  const identity = { slug: repository.route.slug,
    code: course.status === 'ok' ? course.course.code : repository.route.course.code,
    title: course.status === 'ok' ? course.course.title : repository.route.course.title }
  // A plan that does not include the course stops here; the database would refuse the read anyway.
  if (course.course.content.state === 'locked') return { status: 'locked', course: identity,
    ...(course.course.content.reason === 'outside-list' ? { outsideList: true } : {}),
    ...(course.course.content.reason ? { reason: course.course.content.reason } : {}) }
  if (course.course.content.state === 'not-available') return { status: 'unavailable', notAvailable: true }
  if (course.course.content.state === 'temporarily-unavailable') return { status: 'unavailable' }
  const published = await getPublishedManagedContentWithVerifiedClient(client, repository.repositoryCourseId)
  if (published.status === 'locked') return { status: 'locked', course: identity }
  if (published.status !== 'ok') return { status: published.status === 'signed-out' ? published.status : 'unavailable' }
  const materials = projectTheoryPractice(published.content)
  if (materials === null) return { status: 'unavailable' }
  return { status: 'ready', course: { ...identity, href: repository.route.href, repositoryCourseId: repository.repositoryCourseId },
    materials: materials.map(({ question, feedbackAvailable }) => ({ question, feedbackAvailable, feedback: null })) }
}
