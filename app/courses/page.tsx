// Account-gated full institutional catalogue, consumed through the central read model.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { PageBand } from '@/components/student/PageBand'
import { Notice } from '@/components/student/Notice'
import { studentAction } from '@/components/student/ui'
import { btnGhost } from '@/components/chrome/ui'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { getStudentCatalogueForVerifiedStudent } from '@/lib/courses/read-model'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { CourseDirectory } from './CourseDirectory'
import { CourseResult } from './CourseResult'
import { CATALOGUE_LEDE } from './catalogue-presentation'
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
  if (result.status === 'signed-out') {
    redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(STUDENT_DESTINATIONS.courses.href))
  }
  return <div className="student-register-page" data-student-app>
    <PageBand title={STUDENT_DESTINATIONS.courses.label} lede={CATALOGUE_LEDE}
      context={<p>Institutional course catalogue</p>}
      aside={result.status === 'ok' && <p className="student-register-summary">
        {result.courses.length} {result.courses.length === 1 ? 'course' : 'courses'}
      </p>} />
    <div className="student-workspace student-register-workspace">
      {result.status === 'ok'
        ? <CourseDirectory items={result.courses.map(course => ({
          institutionalCourseId: course.institutionalCourseId, code: course.code, title: course.title,
          applicability: course.applicability, row: <CourseResult key={course.institutionalCourseId} course={course} />,
        }))} />
        : result.status === 'invariant-failure'
          ? <Notice title="Course information needs attention" action={
            <Link href={STUDENT_DESTINATIONS.contact.href} prefetch={false} className={studentAction(btnGhost)}>Contact support</Link>
          }>We couldn’t load reliable course information. Please contact support.</Notice>
          : <Notice title="Courses temporarily unavailable" action={
            <a href={STUDENT_DESTINATIONS.courses.href} className={studentAction(btnGhost)}>Try again</a>
          }>Content temporarily unavailable.</Notice>}
    </div>
  </div>
}
