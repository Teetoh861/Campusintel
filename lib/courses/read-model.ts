// lib/courses/read-model.ts — Central Student Course read model: institutional identity, applicability,
// repository linkage, canonical route metadata and published study availability in one derivation.
import 'server-only'
import { z } from 'zod'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getCourseByContentKey, getCourseBySlug } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedContentWithVerifiedClient } from '@/lib/managed-content/published'
import { getUsableManagedQuiz } from '@/lib/managed-content/quiz'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import { classifyStoredSelection } from '@/lib/profile/selection'
import type { User } from '@supabase/supabase-js'
import type { ManagedNote, ManagedOverview, ManagedTheoryQuestion, StudentLearning }
  from '@/lib/managed-content/student-projection'
import type { SelectionIds } from '@/lib/profile/selection'
import type { createClient } from '@/lib/supabase/server'
import type { Course } from '@/lib/types'

type StudentClient = Awaited<ReturnType<typeof createClient>>

// ---------------------------------------------------------------------------
// Central types
// ---------------------------------------------------------------------------

export type CatalogueReference = { id: string; label: string; isActive: boolean }

export type StudentCourseApplicability = {
  department: CatalogueReference
  academicLevel: CatalogueReference
  academicPeriod: CatalogueReference
}

/** Canonical route metadata, resolvable only through the static course shelf. */
export type StudentCourseRoute = { slug: string; href: string; course: Course }

/** Structural repository state. Route capability lives here, independent of study readiness. */
export type StudentCourseRepository =
  | { state: 'unlinked' }
  | { state: 'unshelved-repository'; repositoryCourseId: string; contentKey: string; isShared: boolean | null }
  | { state: 'shelved'; repositoryCourseId: string; contentKey: string; isShared: boolean | null
      route: StudentCourseRoute }

export type StudyAvailability = { notes: boolean; cbtPractice: boolean; theory: boolean; overview: boolean }

/** Published study state. `ready` requires at least one of notes, cbtPractice or theory. */
export type StudentCourseContent =
  | { state: 'not-built'; reason: 'unlinked' }
  | { state: 'ready'; study: StudyAvailability }
  | { state: 'no-published-learning'; study: StudyAvailability }
  | { state: 'temporarily-unavailable'; reason: 'publication-read-failed' | 'projection-failed' }

export type StudentCourse = {
  institutionalCourseId: string
  code: string
  title: string
  isFree: boolean
  applicability: StudentCourseApplicability[]
  repository: StudentCourseRepository
  content: StudentCourseContent
}

type LinkedRepository = Exclude<StudentCourseRepository, { state: 'unlinked' }>
type LinkedContent = Exclude<StudentCourseContent, { state: 'not-built' }>

/** A shelved repository identity that no confirmed institutional course owns. */
export type RepositoryOnlyCourse = {
  repository: Extract<StudentCourseRepository, { state: 'shelved' }>
  content: LinkedContent
}

export type StudentCatalogueResult =
  | { status: 'ok'; courses: StudentCourse[] }
  | { status: 'signed-out' | 'unavailable' | 'invariant-failure' }

export type CurrentStudentCoursesResult =
  | { status: 'ok'; selection: SelectionIds; courses: StudentCourse[] }
  | { status: 'signed-out' | 'missing-profile' | 'incomplete' | 'unavailable' | 'invariant-failure' }

/** Course Detail payload: the validated managed bodies behind the one-course availability flags. */
export type StudentCourseDetailLearning = {
  overview: ManagedOverview | null
  notes: ManagedNote[]
  theoryQuestions: ManagedTheoryQuestion[]
}

/** Course Detail practice summary from the same usable-quiz result that set `cbtPractice`. */
export type StudentCoursePractice = { href: string; bankSize: number; attemptSize: number; timerSeconds: number }

type StudentCourseDetail = {
  learning: StudentCourseDetailLearning | null
  practice: StudentCoursePractice | null
}

/** A one-course `ok` result always resolved through the static shelf, so its route is guaranteed. */
export type RoutedStudentCourse = StudentCourse & { repository: Extract<StudentCourseRepository, { state: 'shelved' }> }

export type StudentCourseLookupResult =
  | ({ status: 'ok'; course: RoutedStudentCourse } & StudentCourseDetail)
  | ({ status: 'repository-only'; course: RepositoryOnlyCourse } & StudentCourseDetail)
  | { status: 'signed-out' | 'not-found' | 'unavailable' | 'invariant-failure' }

// ---------------------------------------------------------------------------
// Structural query contract
// ---------------------------------------------------------------------------

const PROFILE_COLUMNS = 'department_id,academic_level_id,academic_period_id'
const REFERENCE_COLUMNS = 'id,display_name,is_active'
const REPOSITORY_COLUMNS = 'id,content_key,is_shared'
// Embedded relationships use PostgREST's left join so an unlinked course stays visible.
const IDENTITY_COLUMNS = `
  id,course_code,display_title,is_free,repository_course_id,
  repository:courses!institutional_courses_repository_course_id_fkey(${REPOSITORY_COLUMNS})`
const APPLICABILITY_COLUMNS = `
  department_id,academic_level_id,academic_period_id,
  department:departments!course_applicability_department_id_fkey(${REFERENCE_COLUMNS}),
  academic_level:academic_levels!course_applicability_academic_level_id_fkey(${REFERENCE_COLUMNS}),
  academic_period:academic_periods!course_applicability_academic_period_id_fkey(${REFERENCE_COLUMNS})`
const CATALOGUE_COLUMNS = `${IDENTITY_COLUMNS},
  applicability:course_applicability!course_applicability_institutional_course_id_fkey(${APPLICABILITY_COLUMNS})`
const CURRENT_STUDENT_COLUMNS = `institutional_course_id,${APPLICABILITY_COLUMNS},
  institutional:institutional_courses!course_applicability_institutional_course_id_fkey(${IDENTITY_COLUMNS})`
// PostgREST silently caps a result at supabase/config.toml `max_rows`; a capped catalogue is not the catalogue.
const STRUCTURAL_ROW_CAP = 1000

const uuid = z.string().uuid()
const contentKey = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const referenceRow = z.object({ id: uuid, display_name: z.string().min(1), is_active: z.boolean() }).strict()
const repositoryRow = z.object({ id: uuid, content_key: contentKey, is_shared: z.boolean().nullable() }).strict()
const identityRow = z.object({
  id: uuid,
  course_code: z.string().min(1),
  display_title: z.string().min(1),
  is_free: z.boolean(),
  repository_course_id: uuid.nullable(),
  repository: repositoryRow.nullable(),
}).strict()
const applicabilityRow = z.object({
  department_id: uuid,
  academic_level_id: uuid,
  academic_period_id: uuid,
  department: referenceRow,
  academic_level: referenceRow,
  academic_period: referenceRow,
}).strict()
const catalogueRow = identityRow.extend({ applicability: applicabilityRow.array() }).strict()
const currentStudentRow = applicabilityRow.extend({
  institutional_course_id: uuid,
  institutional: identityRow,
}).strict()

type IdentityRow = z.infer<typeof identityRow>
type ApplicabilityRow = z.infer<typeof applicabilityRow>
type Structure = Omit<StudentCourse, 'content'>

// ---------------------------------------------------------------------------
// Structural derivation (shared by every reader)
// ---------------------------------------------------------------------------

function toReference(row: z.infer<typeof referenceRow>): CatalogueReference {
  return { id: row.id, label: row.display_name, isActive: row.is_active }
}

function compareIds(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1
}

function compareApplicability(a: StudentCourseApplicability, b: StudentCourseApplicability): number {
  return compareIds(a.department.id, b.department.id) ||
    compareIds(a.academicLevel.id, b.academicLevel.id) ||
    compareIds(a.academicPeriod.id, b.academicPeriod.id)
}

function compareCodeThenId(a: StudentCourse, b: StudentCourse): number {
  return compareIds(a.code, b.code) || compareIds(a.institutionalCourseId, b.institutionalCourseId)
}

/** Resolve the structural repository state; the route exists only through the static shelf. */
function deriveRepository(identity: IdentityRow): StudentCourseRepository | null {
  const { repository_course_id: repositoryCourseId, repository } = identity
  if (repositoryCourseId === null) return repository === null ? { state: 'unlinked' } : null
  if (repository === null || repository.id !== repositoryCourseId) return null
  const linked = { repositoryCourseId, contentKey: repository.content_key, isShared: repository.is_shared }
  const course = getCourseByContentKey(repository.content_key)
  if (!course) return { state: 'unshelved-repository', ...linked }
  return { state: 'shelved', ...linked,
    route: { slug: course.slug, href: `/courses/${encodeURIComponent(course.slug)}`, course } }
}

/** Derive one institutional identity with all of its applicability; null is an invariant failure. */
function deriveStructure(identity: IdentityRow, rows: ReadonlyArray<ApplicabilityRow>): Structure | null {
  const repository = deriveRepository(identity)
  if (repository === null) return null
  const tuples = new Set<string>()
  const applicability: StudentCourseApplicability[] = []
  for (const row of rows) {
    if (row.department.id !== row.department_id || row.academic_level.id !== row.academic_level_id ||
        row.academic_period.id !== row.academic_period_id) return null
    const tuple = `${row.department_id}/${row.academic_level_id}/${row.academic_period_id}`
    if (tuples.has(tuple)) return null
    tuples.add(tuple)
    applicability.push({ department: toReference(row.department),
      academicLevel: toReference(row.academic_level), academicPeriod: toReference(row.academic_period) })
  }
  applicability.sort(compareApplicability)
  return {
    institutionalCourseId: identity.id,
    code: identity.course_code,
    title: identity.display_title,
    isFree: identity.is_free,
    applicability,
    repository,
  }
}

// ---------------------------------------------------------------------------
// Published study availability (shared by every reader)
// ---------------------------------------------------------------------------

/** One usable-quiz calculation yields both the CBT flag and the Detail practice summary. */
function deriveStudy(learning: StudentLearning, repository: LinkedRepository): {
  study: StudyAvailability; practice: StudentCoursePractice | null
} {
  const { overview } = learning
  const route = repository.state === 'shelved' ? repository.route : null
  // The quiz keeps its repository policy, so an unshelved repository can never offer CBT.
  const quiz = route === null ? null : getUsableManagedQuiz(route.slug,
    getQuizConfigurationByCourseSlug(route.slug), learning.quizQuestions)
  const practice = quiz === null ? null
    : { href: quiz.href, bankSize: quiz.bankSize, attemptSize: quiz.attemptSize, timerSeconds: quiz.timerSeconds }
  return { practice, study: {
    notes: learning.notes.length > 0,
    cbtPractice: practice !== null,
    theory: learning.theoryQuestions.length > 0,
    overview: Boolean(overview && (
      overview.body.trim() || overview.topics?.length || overview.examFocus?.length ||
      overview.keyTakeaways?.length || overview.formulaSheet?.length
    )),
  } }
}

type ResolvedPublication = { content: LinkedContent } & StudentCourseDetail

/** Read one linked repository's publication on the caller's verified client. */
async function resolvePublication(
  client: StudentClient, repository: LinkedRepository,
): Promise<ResolvedPublication | 'signed-out'> {
  const published = await getPublishedManagedContentWithVerifiedClient(client, repository.repositoryCourseId)
  if (published.status === 'signed-out') return 'signed-out'
  if (published.status !== 'ok') {
    return { content: { state: 'temporarily-unavailable', reason: 'publication-read-failed' }, learning: null, practice: null }
  }
  const projected = projectStudentLearning(published.content)
  if (projected.status !== 'ok') {
    return { content: { state: 'temporarily-unavailable', reason: 'projection-failed' }, learning: null, practice: null }
  }
  const { study, practice } = deriveStudy(projected.learning, repository)
  const { overview, notes, theoryQuestions } = projected.learning
  // Overview is context only; it never makes a course ready to study.
  const content: LinkedContent = study.notes || study.cbtPractice || study.theory
    ? { state: 'ready', study } : { state: 'no-published-learning', study }
  return { content, learning: { overview, notes, theoryQuestions }, practice }
}

/** Catalogue readers keep only availability; payload bodies never reach catalogue rows. */
async function resolvePublishedContent(
  client: StudentClient, repository: LinkedRepository,
): Promise<LinkedContent | 'signed-out'> {
  const resolved = await resolvePublication(client, repository)
  return resolved === 'signed-out' ? resolved : resolved.content
}

function resolveContent(
  client: StudentClient, repository: StudentCourseRepository,
): Promise<StudentCourseContent | 'signed-out'> {
  if (repository.state === 'unlinked') return Promise.resolve({ state: 'not-built', reason: 'unlinked' })
  return resolvePublishedContent(client, repository)
}

/** Bounded fan-out across linked identities only; one lost session fails the whole read. */
async function resolveCourses(
  client: StudentClient, structures: ReadonlyArray<Structure>,
): Promise<StudentCourse[] | 'signed-out'> {
  const contents = await Promise.all(structures.map(structure => resolveContent(client, structure.repository)))
  const courses: StudentCourse[] = []
  for (const [index, content] of contents.entries()) {
    if (content === 'signed-out') return 'signed-out'
    courses.push({ ...structures[index], content })
  }
  return courses.sort(compareCodeThenId)
}

/** Every identity the Student App presents as a course row: institutional, or repository-only. */
export type PresentableStudentCourse = StudentCourse | RepositoryOnlyCourse

type ActionableCourseState = {
  repository: Extract<StudentCourseRepository, { state: 'shelved' }>
  content: Extract<StudentCourseContent, { state: 'ready' }>
}

/** A course a student can open now: a canonical route plus currently published study content. */
export type ActionableStudentCourse = StudentCourse & ActionableCourseState

/** Institutional identity is the only presentable shape that carries a confirmed code and title. */
export function isInstitutionalStudentCourse(course: PresentableStudentCourse): course is StudentCourse {
  return 'institutionalCourseId' in course
}

/** Shelved AND ready is the one actionability rule, for institutional and repository-only identities alike. */
export function isActionableStudentCourse<T extends PresentableStudentCourse>(course: T): course is T & ActionableCourseState {
  return course.repository.state === 'shelved' && course.content.state === 'ready'
}

/** Why a course cannot be opened: an honest content gap, or a temporary route/publication problem. */
export function getStudentCourseUnavailability(course: PresentableStudentCourse): 'missing' | 'temporary' | null {
  if (isActionableStudentCourse(course)) return null
  if (course.repository.state === 'unlinked') return 'missing'
  if (course.repository.state === 'unshelved-repository') return 'temporary'
  return course.content.state === 'no-published-learning' ? 'missing' : 'temporary'
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Read the whole institutional catalogue in one structural query on the verified client. */
export async function getStudentCatalogueForVerifiedStudent(client: StudentClient): Promise<StudentCatalogueResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const result = await client.from('institutional_courses').select(CATALOGUE_COLUMNS)
    if (result.error || result.data === null) return { status: 'unavailable' }
    const parsed = catalogueRow.array().safeParse(result.data)
    if (!parsed.success || parsed.data.length >= STRUCTURAL_ROW_CAP) return { status: 'invariant-failure' }
    const seen = new Set<string>()
    const structures: Structure[] = []
    for (const row of parsed.data) {
      if (seen.has(row.id)) return { status: 'invariant-failure' }
      seen.add(row.id)
      const structure = deriveStructure(row, row.applicability)
      if (structure === null) return { status: 'invariant-failure' }
      structures.push(structure)
    }
    const courses = await resolveCourses(client, structures)
    return courses === 'signed-out' ? { status: 'signed-out' } : { status: 'ok', courses }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Read the verified student's saved selection and its institutional courses on the same client. */
export async function getCurrentStudentCoursesForVerifiedStudent(
  client: StudentClient, user: User,
): Promise<CurrentStudentCoursesResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
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
      .select(CURRENT_STUDENT_COLUMNS)
      .eq('department_id', selection.departmentId)
      .eq('academic_level_id', selection.academicLevelId)
      .eq('academic_period_id', selection.academicPeriodId)
    if (result.error || result.data === null) return { status: 'unavailable' }
    const parsed = currentStudentRow.array().safeParse(result.data)
    if (!parsed.success) return { status: 'invariant-failure' }

    const seen = new Set<string>()
    const structures: Structure[] = []
    for (const row of parsed.data) {
      const { institutional_course_id: institutionalCourseId, institutional, ...tuple } = row
      if (institutionalCourseId !== institutional.id || seen.has(institutional.id) ||
          tuple.department_id !== selection.departmentId ||
          tuple.academic_level_id !== selection.academicLevelId ||
          tuple.academic_period_id !== selection.academicPeriodId) {
        return { status: 'invariant-failure' }
      }
      seen.add(institutional.id)
      const structure = deriveStructure(institutional, [tuple])
      if (structure === null) return { status: 'invariant-failure' }
      structures.push(structure)
    }
    const courses = await resolveCourses(client, structures)
    return courses === 'signed-out' ? { status: 'signed-out' } : { status: 'ok', selection, courses }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Resolve one route slug through the static shelf, the repository row and its institutional owner. */
export async function getStudentCourseBySlugForVerifiedStudent(
  client: StudentClient, slug: string,
): Promise<StudentCourseLookupResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  const course = getCourseBySlug(slug)
  if (!course) return { status: 'not-found' }
  try {
    const bridge = await client.from('courses').select(REPOSITORY_COLUMNS)
      .eq('content_key', course.contentKey).maybeSingle()
    if (bridge.error) return { status: 'unavailable' }
    if (bridge.data === null) return { status: 'not-found' }
    const repositoryParsed = repositoryRow.safeParse(bridge.data)
    if (!repositoryParsed.success || repositoryParsed.data.content_key !== course.contentKey) {
      return { status: 'invariant-failure' }
    }
    const repositoryCourseId = repositoryParsed.data.id

    const owner = await client.from('institutional_courses').select(CATALOGUE_COLUMNS)
      .eq('repository_course_id', repositoryCourseId).maybeSingle()
    if (owner.error) return { status: 'unavailable' }
    if (owner.data === null) {
      // Repository-only: never fabricate an institutional code, title or applicability.
      const repository: RepositoryOnlyCourse['repository'] = {
        state: 'shelved', repositoryCourseId, contentKey: course.contentKey,
        isShared: repositoryParsed.data.is_shared,
        route: { slug: course.slug, href: `/courses/${encodeURIComponent(course.slug)}`, course },
      }
      const resolved = await resolvePublication(client, repository)
      return resolved === 'signed-out' ? { status: 'signed-out' } : { status: 'repository-only',
        course: { repository, content: resolved.content }, learning: resolved.learning, practice: resolved.practice }
    }
    const ownerParsed = catalogueRow.safeParse(owner.data)
    if (!ownerParsed.success) return { status: 'invariant-failure' }
    const structure = deriveStructure(ownerParsed.data, ownerParsed.data.applicability)
    if (structure === null || structure.repository.state !== 'shelved' ||
        structure.repository.repositoryCourseId !== repositoryCourseId ||
        structure.repository.route.slug !== course.slug) {
      return { status: 'invariant-failure' }
    }
    const repository = structure.repository
    const resolved = await resolvePublication(client, repository)
    return resolved === 'signed-out' ? { status: 'signed-out' } : { status: 'ok',
      course: { ...structure, repository, content: resolved.content }, learning: resolved.learning, practice: resolved.practice }
  } catch {
    return { status: 'unavailable' }
  }
}
