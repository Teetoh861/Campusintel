// lib/ai-practice/campus-bot-courses.ts — Where Campus Bot opens for a student. Its page and the link on a course row
// both decide here, so the link shows only where tapping it opens Campus Bot or its notice.
import 'server-only'
import { isAiPracticeAvailable } from '@/lib/ai-practice/config'
import { isCampusBotCourse } from '@/lib/ai-practice/student-flow'
import { listCoursesWithPersonalSets } from '@/lib/ai-practice/supabase-env'
import { getCourseAccessForVerifiedStudent } from '@/lib/courses/access'
import { getStudentCourseUnavailability, isInstitutionalStudentCourse } from '@/lib/courses/read-model'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import type { User } from '@supabase/supabase-js'
import type { CourseDecision } from '@/lib/courses/access'
import type { PresentableStudentCourse, StudentCourse } from '@/lib/courses/read-model'
import type { createClient } from '@/lib/supabase/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

// get_my_course_access answers at most this many courses in one read.
const ACCESS_BATCH_SIZE = 200

/**
 * The Campus Bot page opens for a course Campus Bot covers for the student, and for one they still have question sets
 * for. For any other course it sends them back to My Courses, so that course's row shows no link.
 */
export function opensCampusBot(covered: boolean, hasSets: boolean): boolean {
  return covered || hasSets
}

/** A row that can carry the link at all (PRD 4.3): an institutional course with nothing built, while Campus Bot is on. */
export function isCampusBotRow(course: StudentCourse): boolean {
  return getStudentCourseUnavailability(course) === 'missing' && isAiPracticeAvailable()
}

async function readDecisions(client: StudentClient, courseIds: readonly string[]):
  Promise<ReadonlyMap<string, CourseDecision>> {
  const decisions = new Map<string, CourseDecision>()
  for (let offset = 0; offset < courseIds.length; offset += ACCESS_BATCH_SIZE) {
    const read = await getCourseAccessForVerifiedStudent(client, courseIds.slice(offset, offset + ACCESS_BATCH_SIZE))
    // An unread decision covers nothing.
    if (read.status !== 'ok') break
    for (const [id, decision] of read.decisions) decisions.set(id, decision)
  }
  return decisions
}

/** Which of these courses Campus Bot covers for the student, from their access decisions and saved selection. */
export async function readCampusBotCourses(client: StudentClient, user: User, courses: readonly StudentCourse[]):
  Promise<ReadonlySet<string>> {
  const [decisions, profile] = await Promise.all([
    readDecisions(client, courses.map(course => course.institutionalCourseId)),
    getCurrentStudentProfileForVerifiedStudent(client, user)])
  const selection = profile.status === 'complete' ? profile.selection : null
  return new Set(courses.filter(course => isCampusBotCourse(decisions.get(course.institutionalCourseId), course, selection))
    .map(course => course.institutionalCourseId))
}

/** The courses whose row shows the Campus Bot link. A read that fails shows no link. */
export async function readCampusBotLinks(client: StudentClient, user: User,
  courses: readonly PresentableStudentCourse[]): Promise<ReadonlySet<string>> {
  const rows = courses.filter(isInstitutionalStudentCourse).filter(isCampusBotRow)
  if (rows.length === 0) return new Set()
  try {
    const covered = await readCampusBotCourses(client, user, rows)
    const others = rows.map(course => course.institutionalCourseId).filter(id => !covered.has(id))
    const withSets = others.length === 0 ? new Set<string>() : await listCoursesWithPersonalSets(client, user.id, others)
    return new Set(rows.map(course => course.institutionalCourseId)
      .filter(id => opensCampusBot(covered.has(id), withSets.has(id))))
  } catch {
    return new Set()
  }
}
