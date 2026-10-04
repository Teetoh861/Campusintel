import 'server-only'
import { z } from 'zod'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { getCourseByContentKey } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedContentWithVerifiedClient } from '@/lib/managed-content/published'
import { getUsableManagedQuiz } from '@/lib/managed-content/quiz'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import { classifyStoredSelection } from '@/lib/profile/selection'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'
import type { SelectionIds } from '@/lib/profile/selection'
import type { Course } from '@/lib/types'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const PROFILE_COLUMNS = 'department_id,academic_level_id,academic_period_id'
// Embedded relationships use PostgREST's left join so an unbuilt course stays visible.
const COURSE_COLUMNS = `
  institutional_course_id,
  institutional:institutional_courses!course_applicability_institutional_course_id_fkey(
    id,course_code,display_title,is_free,repository_course_id,
    content:courses!institutional_courses_repository_course_id_fkey(id,content_key)
  )
`

const repositoryRowSchema = z.object({
  id: z.string().uuid(),
  content_key: z.string().min(1),
}).strict()

const applicabilityRowSchema = z.object({
  institutional_course_id: z.string().uuid(),
  institutional: z.object({
    id: z.string().uuid(),
    course_code: z.string().min(1),
    display_title: z.string().min(1),
    is_free: z.boolean(),
    repository_course_id: z.string().uuid().nullable(),
    content: repositoryRowSchema.nullable(),
  }).strict(),
}).strict()

type ApplicabilityRow = z.infer<typeof applicabilityRowSchema>

export type DashboardContent =
  | { state: 'not-built' }
  | { state: 'broken-link' }
  | { state: 'unavailable' }
  | { state: 'no-learning' }
  | {
      state: 'ready'
      courseSlug: string
      courseHref: string
      availability: { overview: boolean; theory: boolean; quiz: boolean }
    }

export type DashboardCourse = {
  institutionalCourseId: string
  code: string
  title: string
  isFree: boolean
  content: DashboardContent
}

export type CurrentStudentCoursesResult =
  | { status: 'signed-out' | 'missing-profile' | 'incomplete' | 'unavailable' | 'invariant-failure' }
  | { status: 'complete'; selection: SelectionIds; courses: DashboardCourse[] }

async function resolveContent(row: ApplicabilityRow, client: StudentClient): Promise<DashboardContent | 'signed-out'> {
  const institutional = row.institutional
  const repositoryCourseId = institutional.repository_course_id
  if (repositoryCourseId === null) return { state: 'not-built' }

  let course: Course
  try {
    if (institutional.content?.id !== repositoryCourseId) {
      throw new Error('Linked repository registry row is unavailable')
    }
    const resolved = getCourseByContentKey(institutional.content.content_key)
    if (!resolved) throw new Error('Linked content key is absent from the repository')
    course = resolved
  } catch (error) {
    // Keep the institutional course visible while reporting the broken bridge.
    console.error('Dashboard repository content link invariant failed', {
      institutionalCourseId: institutional.id,
      repositoryCourseId,
      error,
    })
    return { state: 'broken-link' }
  }

  // The course page reads this same published-only boundary. Repository quiz,
  // theory and note files cannot establish what a student can study today.
  const published = await getPublishedManagedContentWithVerifiedClient(client, repositoryCourseId)
  if (published.status === 'signed-out') return 'signed-out'
  if (published.status !== 'ok') return { state: 'unavailable' }
  const projected = projectStudentLearning(published.content)
  if (projected.status !== 'ok') return { state: 'unavailable' }
  const { overview, theoryQuestions, quizQuestions } = projected.learning
  const hasOverview = Boolean(overview && (
    overview.body.trim() || overview.topics?.length || overview.examFocus?.length ||
    overview.keyTakeaways?.length || overview.formulaSheet?.length
  ))
  const hasTheory = theoryQuestions.length > 0
  const hasQuiz = getUsableManagedQuiz(course.slug,
    getQuizConfigurationByCourseSlug(course.slug), quizQuestions) !== null
  if (!hasOverview && !hasTheory && !hasQuiz) return { state: 'no-learning' }

  return {
    state: 'ready',
    courseSlug: course.slug,
    courseHref: `/courses/${encodeURIComponent(course.slug)}`,
    availability: { overview: hasOverview, theory: hasTheory, quiz: hasQuiz },
  }
}

function compareCodeThenId(a: DashboardCourse, b: DashboardCourse): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1
  if (a.institutionalCourseId === b.institutionalCourseId) return 0
  return a.institutionalCourseId < b.institutionalCourseId ? -1 : 1
}

async function readCurrentStudentCourses(
  client: StudentClient, user: User,
): Promise<CurrentStudentCoursesResult> {
  try {
    const profile = await client.from('profiles')
      .select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle()
    if (profile.error) return { status: 'unavailable' }
    if (profile.data === null) return { status: 'missing-profile' }
    const stored = classifyStoredSelection(profile.data)
    if (stored.kind === 'invariant-failure') return { status: 'invariant-failure' }
    if (stored.kind === 'incomplete') return { status: 'incomplete' }

    const selection = stored.ids
    const result = await client.from('course_applicability')
      .select(COURSE_COLUMNS)
      .eq('department_id', selection.departmentId)
      .eq('academic_level_id', selection.academicLevelId)
      .eq('academic_period_id', selection.academicPeriodId)
    if (result.error || result.data === null) return { status: 'unavailable' }
    const parsed = applicabilityRowSchema.array().safeParse(result.data)
    if (!parsed.success) return { status: 'invariant-failure' }

    const seen = new Set<string>()
    const courses: DashboardCourse[] = []
    for (const row of parsed.data) {
      const institutional = row.institutional
      if (row.institutional_course_id !== institutional.id ||
          seen.has(institutional.id) ||
          (institutional.repository_course_id === null && institutional.content !== null)) {
        return { status: 'invariant-failure' }
      }
      seen.add(institutional.id)
      courses.push({
        institutionalCourseId: institutional.id,
        code: institutional.course_code,
        title: institutional.display_title,
        isFree: institutional.is_free,
        content: { state: 'not-built' },
      })
    }
    const resolved = await Promise.all(parsed.data.map(row => resolveContent(row, client)))
    if (resolved.includes('signed-out')) return { status: 'signed-out' }
    resolved.forEach((content, index) => {
      if (content !== 'signed-out') courses[index].content = content
    })
    courses.sort(compareCodeThenId)
    return { status: 'complete', selection, courses }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Reuse the page's already-validated student and its exact cookie-bound RLS client. */
export async function getCurrentStudentCoursesForVerifiedStudent(
  client: StudentClient, user: User,
): Promise<CurrentStudentCoursesResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  return await readCurrentStudentCourses(client, user)
}

/** Read the live student's saved selection and its institutional courses. */
export async function getCurrentStudentCourses(): Promise<CurrentStudentCoursesResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient()
    const user = await getStudentSessionUser(undefined, client)
    if (user === null) return { status: 'signed-out' }
    return await readCurrentStudentCourses(client, user)
  } catch { return { status: 'unavailable' } }
}
