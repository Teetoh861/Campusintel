// Account-gated full institutional catalogue, consumed through the central read model.
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentCourseRow } from '@/components/student/StudentCourseRow'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { getStudentCatalogueForVerifiedStudent } from '@/lib/courses/read-model'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { CourseDirectory } from './CourseDirectory'
import { CATALOGUE_CONTEXT, CATALOGUE_LEDE } from './catalogue-presentation'
import type { StudentCatalogueResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'All Courses | CampusIntell', robots: { index: false, follow: false } }

/** Preserve the existing live account and completed-profile boundary. */
export default function CoursesPage(): ReactElement {
  return <StudentAccessGate returnPath={STUDENT_DESTINATIONS.courses.href}><CourseDirectoryPage /></StudentAccessGate>
}

async function CourseDirectoryPage(): Promise<ReactElement> {
  let result: StudentCatalogueResult
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    result = context === null ? { status: 'signed-out' } : await getStudentCatalogueForVerifiedStudent(client)
  } catch { result = { status: 'unavailable' } }
  if (result.status === 'signed-out') redirectForStudentState('signed-out', STUDENT_DESTINATIONS.courses.href)
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.courses.label} lede={CATALOGUE_LEDE}
    context={<p>{CATALOGUE_CONTEXT}</p>}
    aside={result.status === 'ok' && result.courses.length > 0 && <p className="student-summary">
      {result.courses.length} {result.courses.length === 1 ? 'course' : 'courses'}
    </p>} />}>
    {result.status === 'ok'
      ? <CourseDirectory items={result.courses.map(course => ({
        institutionalCourseId: course.institutionalCourseId, code: course.code, title: course.title,
        applicability: course.applicability, row: <StudentCourseRow key={course.institutionalCourseId} course={course} />,
      }))} />
      : <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'courses-unavailable'}
        retryHref={STUDENT_DESTINATIONS.courses.href} />}
  </StudentPage>
}
