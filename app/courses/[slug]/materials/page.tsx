// Course materials (/courses/[slug]/materials) — server-rendered, course-aware.
// Requests and contributions are private, course-specific email handoffs. They name the student's own course, its
// catalogue code and title as the course page shows them, never the course list's code.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { PageBand } from '@/components/student/PageBand'
import { ResultNotice } from '@/components/student/ResultNotice'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getStudentCourseBySlugForVerifiedStudent } from '@/lib/courses/read-model'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import {
  buildMaterialRequestEmailUrl,
  buildMaterialShareEmailUrl,
} from '@/lib/material-email'
import type { StudentCourseLookupResult } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

type PageProps = { params: Promise<{ slug: string }> }

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Request material | CampusIntell', robots: { index: false, follow: false } }

/** Cross the student account boundary before the course request surface renders. */
export default async function CourseMaterialsPage({ params }: PageProps) {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/materials`}><CourseMaterials slug={slug} /></StudentAccessGate>
}

/** The verified course, read as the course page reads it; its study content is not needed here. */
async function readCourse(slug: string): Promise<StudentCourseLookupResult> {
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client)
    return context === null ? { status: 'signed-out' }
      : await getStudentCourseBySlugForVerifiedStudent(client, slug, { readRepositoryOnly: false })
  } catch { return { status: 'unavailable' } }
}

async function CourseMaterials({ slug }: { slug: string }): Promise<ReactElement> {
  const result = await readCourse(slug)
  if (result.status === 'not-found') notFound()
  if (result.status === 'signed-out') return redirectForStudentState('signed-out', `/courses/${slug}/materials`)
  if (result.status !== 'ok' && result.status !== 'repository-only') {
    return <StudentPage band={<PageBand title="Request material" />}>
      <ResultNotice state={result.status === 'invariant-failure' ? 'course-invariant' : 'course-unavailable'}
        retryHref={`/courses/${encodeURIComponent(slug)}/materials`} />
    </StudentPage>
  }
  const { route } = result.course.repository
  // A course no catalogue course owns has no code of its own: it is named by its title alone.
  const code = result.status === 'ok' ? result.course.code : null
  const title = result.status === 'ok' ? result.course.title : route.course.title
  const name = code ?? title
  const courseContext = code ? `${code} — ${title}` : title
  const requestUrl = buildMaterialRequestEmailUrl(courseContext)
  const shareUrl = buildMaterialShareEmailUrl(courseContext)

  return (
    <>
      <header className="bg-ci-navy text-white" data-screen-label="Materials">
        <div className={cx(WRAP, 'py-14 min-[900px]:py-[72px]')}>
          <nav
            className="mb-9 flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200"
            aria-label="Breadcrumb"
          >
            <Link href={STUDENT_DESTINATIONS.dashboard.href} className="transition-colors hover:text-white">{STUDENT_DESTINATIONS.dashboard.label}</Link>
            <span className="text-white/35">/</span>
            <Link href={STUDENT_DESTINATIONS.courses.href} className="transition-colors hover:text-white">{STUDENT_DESTINATIONS.courses.label}</Link>
            <span className="text-white/35">/</span>
            <Link
              href={`${STUDENT_DESTINATIONS.courses.href}/${route.slug}`}
              className="transition-colors hover:text-white"
            >
              {name}
            </Link>
            <span className="text-white/35">/</span>
            <span className="text-white">Materials</span>
          </nav>

          {code && <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-ci-accent">
            {code}
          </div>}
          <h1 className="mt-3 max-w-[20ch] text-balance text-[clamp(36px,7vw,56px)] font-extrabold leading-none tracking-[-0.035em]">
            {title}
          </h1>
        </div>
      </header>

      <section className="py-14 min-[900px]:py-[72px]" data-screen-label="Material options">
        <div className={WRAP}>
          <div className="mx-auto max-w-[720px] rounded-[18px] border border-ci-border bg-ci-white p-6 shadow-ci-card min-[680px]:p-8">
            <div className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              <a
                className={cx(btnBase, btnAccent, 'w-full')}
                href={requestUrl}
                aria-label={`Request study material for ${name} by email`}
              >
                Request material
              </a>
              <a
                className={cx(btnBase, btnNavy, 'w-full')}
                href={shareUrl}
                aria-label={`Share study material for ${name} by email`}
              >
                Send materials
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
