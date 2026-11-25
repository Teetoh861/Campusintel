// lib/dashboard/home-courses.ts — What home shows of the student's semester (owner's sprint plan of 23 Oct, item 2):
// the chosen courses, each open or locked, and once the student has started, a Continue card and progress per course.
// Every figure comes from the student's own server-run attempts (practice_progress) and the published_cbt_summary
// total; nothing is estimated, and a course never practised shows none.
import { getCourseByContentKey } from '@/lib/data/courses'
import { getStudentCourseUnavailability } from '@/lib/courses/read-model'
import type { StudentCourse } from '@/lib/courses/read-model'
import type { PracticeCourseRef, PracticeProgress } from '@/lib/practice/progress'

export type HomeCourseStatus = 'open' | 'locked' | 'missing' | 'temporary'

export type HomeCourse = {
  id: string
  code: string
  title: string
  status: HomeCourseStatus
  // The course page when the shelf has one; null leaves the row as text.
  href: string | null
  // Null until the student has a graded attempt or an instant pick in this course; an open exam adds nothing until
  // it is graded. lastScore is null until an attempt with an answer has finished.
  progress: { practised: number; total: number | null; lastScore: { score: number; total: number } | null } | null
}

export type ContinuePractice =
  // minutesLeft is null for instant feedback, which shows no clock.
  | { kind: 'resume'; code: string; title: string; href: string; minutesLeft: number | null }
  | { kind: 'continue'; code: string; title: string; href: string }

export type HomeCourses = { courses: HomeCourse[]; continuePractice: ContinuePractice | null }

/** A course's verified catalogue code and title, by repository course id: read through the read model for an attempt's
 *  course that is not on the student's list (offListOpenCourse), so the Continue card never names a course by the course
 *  list's code. */
export type CourseLabels = ReadonlyMap<string, { code: string; title: string }>

const MS_PER_MINUTE = 60_000

function statusOf(course: StudentCourse): HomeCourseStatus {
  const unavailability = getStudentCourseUnavailability(course)
  return unavailability === null ? 'open' : unavailability
}

function repositoryIdOf(course: StudentCourse): string | null {
  return course.repository.state === 'unlinked' ? null : course.repository.repositoryCourseId
}

/** The open attempt's course when it is not on the student's list but has a course page: the one course the Continue
 *  card can name from outside the list (a graded attempt is continued only from the list). The page reads its catalogue
 *  code and title (CourseLabels). */
export function offListOpenCourse(courses: ReadonlyArray<StudentCourse>, progress: PracticeProgress):
  { courseId: string; slug: string } | null {
  if (progress.status !== 'ok' || progress.open === null) return null
  const { courseId, contentKey } = progress.open
  if (courses.some(course => repositoryIdOf(course) === courseId)) return null
  const shelf = getCourseByContentKey(contentKey)
  return shelf === undefined || shelf.contentKey !== contentKey ? null : { courseId, slug: shelf.slug }
}

/** The practice page of an attempt's course, named by the student's own row, or off the list by its verified catalogue
 *  course, never by the course list's code; null without a course page or a name. */
function practiceTarget(ref: PracticeCourseRef, courses: ReadonlyArray<StudentCourse>, labels: CourseLabels):
  { code: string; title: string; href: string; locked: boolean } | null {
  const listed = courses.find(course => repositoryIdOf(course) === ref.courseId)
  const shelf = listed?.repository.state === 'shelved' ? listed.repository.route.course : getCourseByContentKey(ref.contentKey)
  if (shelf === undefined || shelf.contentKey !== ref.contentKey) return null
  const named = listed ?? labels.get(ref.courseId)
  if (named === undefined) return null
  return { code: named.code, title: named.title,
    href: `/courses/${encodeURIComponent(shelf.slug)}/quiz`, locked: listed !== undefined && statusOf(listed) === 'locked' }
}

/** An open attempt first; otherwise the course of the latest graded attempt, while it offers practice now (it has a
 * bank size, which a course the student's plan locks never has). An open attempt is resumed whatever the course offers
 * now: the practice page finishes it without a brief. */
function continuePracticeFrom(progress: Extract<PracticeProgress, { status: 'ok' }>,
  courses: ReadonlyArray<StudentCourse>, cbtBankSizes: ReadonlyMap<string, number>, labels: CourseLabels): ContinuePractice | null {
  if (progress.open !== null) {
    const target = practiceTarget(progress.open, courses, labels)
    const left = Date.parse(progress.open.deadlineAt) - Date.parse(progress.now)
    if (target !== null && Number.isFinite(left) && left > 0) {
      return { kind: 'resume', code: target.code, title: target.title, href: target.href,
        minutesLeft: progress.open.mode === 'instant' ? null : Math.ceil(left / MS_PER_MINUTE) }
    }
  }
  if (progress.latest !== null) {
    const target = practiceTarget(progress.latest, courses, labels)
    const listed = courses.find(course => repositoryIdOf(course) === progress.latest?.courseId)
    const practisable = listed !== undefined && (cbtBankSizes.get(listed.institutionalCourseId) ?? 0) > 0
    // Practice continues from the course's topic list, not the practice page.
    if (target !== null && !target.locked && practisable) return { kind: 'continue', code: target.code, title: target.title,
      href: target.href.replace(/\/quiz$/, '#cbtPractice') }
  }
  return null
}

/** Combine the course read and the practice read. An unavailable practice read shows the day-one list. `labels` names
 *  the off-list open attempt's course (offListOpenCourse); without its label the Continue card names no course. */
export function homeCoursesFrom(courses: ReadonlyArray<StudentCourse>, cbtBankSizes: ReadonlyMap<string, number>,
  progress: PracticeProgress, labels: CourseLabels = new Map()): HomeCourses {
  const practised = progress.status === 'ok' ? progress.courses : new Map()
  return {
    courses: courses.map(course => {
      const repositoryId = repositoryIdOf(course)
      const own = repositoryId === null ? undefined : practised.get(repositoryId)
      return { id: course.institutionalCourseId, code: course.code, title: course.title, status: statusOf(course),
        href: course.repository.state === 'shelved' ? course.repository.route.href : null,
        progress: own === undefined ? null
          : { practised: own.practised, total: cbtBankSizes.get(course.institutionalCourseId) ?? null,
            lastScore: own.lastScore } }
    }),
    // An empty list shows only its sentence: nothing to continue, whatever was practised before.
    continuePractice: progress.status === 'ok' && courses.length > 0 ? continuePracticeFrom(progress, courses, cbtBankSizes, labels)
      : null,
  }
}

/** "12 min left", "1 hr left", "1 hr 5 min left". */
export function formatTimeLeft(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (hours === 0) return `${minutes} min left`
  return rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`
}

/** "8 of 40 questions practised · Last score 6 of 10 correct"; the total only when the course's bank can be counted now, the score
 * only once there is one. */
export function formatCourseProgress(progress: NonNullable<HomeCourse['progress']>): string {
  const questions = progress.total === null
    ? `${progress.practised} ${progress.practised === 1 ? 'question' : 'questions'} practised`
    : `${progress.practised} of ${progress.total} questions practised`
  return progress.lastScore === null ? questions
    : `${questions} · Last score ${progress.lastScore.score} of ${progress.lastScore.total} correct`
}
