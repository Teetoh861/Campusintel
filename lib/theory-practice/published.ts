import 'server-only'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { getPublishedManagedContentWithVerifiedClient } from '@/lib/managed-content/published'
import { projectTheoryPractice } from './projection'
import type { createClient } from '@/lib/supabase/server'
import type { TheoryMaterial } from './projection'

export type TheoryPracticeResult =
  | { status: 'ready'; course: { slug: string; href: string; code: string; title: string }; materials: TheoryMaterial[] }
  | { status: 'signed-out' | 'not-found' | 'invariant-failure' | 'unavailable' }

/** Resolve central course identity, then reread published theory on the same verified cookie-bound client. */
export async function getTheoryPracticeForVerifiedStudent(
  client: Awaited<ReturnType<typeof createClient>>, slug: string,
): Promise<TheoryPracticeResult> {
  const course = await getStudentCourseBySlugForVerifiedStudent(client, slug)
  if (course.status !== 'ok' && course.status !== 'repository-only') return course
  if (course.course.content.state === 'temporarily-unavailable') return { status: 'unavailable' }
  const repository = course.course.repository
  const published = await getPublishedManagedContentWithVerifiedClient(client, repository.repositoryCourseId)
  if (published.status !== 'ok') return { status: published.status === 'signed-out' ? 'signed-out' : 'unavailable' }
  const materials = projectTheoryPractice(published.content)
  if (materials === null) return { status: 'unavailable' }
  return { status: 'ready', course: { slug: repository.route.slug, href: repository.route.href,
    code: course.status === 'ok' ? course.course.code : repository.route.course.code,
    title: course.status === 'ok' ? course.course.title : repository.route.course.title }, materials }
}
