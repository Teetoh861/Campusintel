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
  // Null until the student has a graded attempt in this course; an open attempt adds nothing until it is graded.
  progress: { practised: number; total: number | null; lastScore: { score: number; total: number } } | null
}

export type ContinuePractice =
  | { kind: 'resume'; code: string; title: string; href: string; minutesLeft: number }
  | { kind: 'continue'; code: string; title: string; href: string }

export type HomeCourses = { courses: HomeCourse[]; continuePractice: ContinuePractice | null }

const MS_PER_MINUTE = 60_000

function statusOf(course: StudentCourse): HomeCourseStatus {
  const unavailability = getStudentCourseUnavailability(course)
  return unavailability === null ? 'open' : unavailability
}

function repositoryIdOf(course: StudentCourse): string | null {
  return course.repository.state === 'unlinked' ? null : course.repository.repositoryCourseId
}

/** The practice page of an attempt's course: through the student's own row, else the static shelf; null if neither. */
function practiceTarget(ref: PracticeCourseRef, courses: ReadonlyArray<StudentCourse>):
  { code: string; title: string; href: string; locked: boolean } | null {
  const listed = courses.find(course => repositoryIdOf(course) === ref.courseId)
  const shelf = listed?.repository.state === 'shelved' ? listed.repository.route.course : getCourseByContentKey(ref.contentKey)
  if (shelf === undefined || shelf.contentKey !== ref.contentKey) return null
  return { code: listed?.code ?? shelf.code, title: listed?.title ?? shelf.title,
    href: `/courses/${encodeURIComponent(shelf.slug)}/quiz`, locked: listed !== undefined && statusOf(listed) === 'locked' }
}

/** An open attempt first; otherwise the course of the latest graded attempt, unless the student's plan now locks it. */
function continuePracticeFrom(progress: Extract<PracticeProgress, { status: 'ok' }>,
  courses: ReadonlyArray<StudentCourse>): ContinuePractice | null {
  if (progress.open !== null) {
    const target = practiceTarget(progress.open, courses)
    const left = Date.parse(progress.open.deadlineAt) - Date.parse(progress.now)
    if (target !== null && Number.isFinite(left) && left > 0) {
      return { kind: 'resume', code: target.code, title: target.title, href: target.href,
        minutesLeft: Math.ceil(left / MS_PER_MINUTE) }
    }
  }
  if (progress.latest !== null) {
    const target = practiceTarget(progress.latest, courses)
    if (target !== null && !target.locked) return { kind: 'continue', code: target.code, title: target.title, href: target.href }
  }
  return null
}

/** Combine the course read and the practice read. An unavailable practice read shows the day-one list. */
export function homeCoursesFrom(courses: ReadonlyArray<StudentCourse>, cbtBankSizes: ReadonlyMap<string, number>,
  progress: PracticeProgress): HomeCourses {
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
    continuePractice: progress.status === 'ok' && courses.length > 0 ? continuePracticeFrom(progress, courses) : null,
  }
}

/** "12 min left", "1 hr left", "1 hr 5 min left". */
export function formatTimeLeft(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (hours === 0) return `${minutes} min left`
  return rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`
}

/** "8 of 40 questions practised · Last score 6/10"; the total only when the course's bank can be counted now. */
export function formatCourseProgress(progress: NonNullable<HomeCourse['progress']>): string {
  const questions = progress.total === null
    ? `${progress.practised} ${progress.practised === 1 ? 'question' : 'questions'} practised`
    : `${progress.practised} of ${progress.total} questions practised`
  return `${questions} · Last score ${progress.lastScore.score}/${progress.lastScore.total}`
}
