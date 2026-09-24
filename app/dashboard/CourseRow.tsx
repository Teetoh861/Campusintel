import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { AUTH_FOCUS } from '@/components/chrome/FormField'
import { cx } from '@/components/chrome/ui'
import type { DashboardCourse } from '@/lib/dashboard/current-student-courses'

const ROW = 'flex min-h-[76px] items-center gap-3 px-1 py-3 min-[680px]:gap-5'

/** Keep every institutional course visible; only resolved content has a destination. */
export function CourseRow({ course }: { course: DashboardCourse }) {
  const { content } = course
  const ready = content.state === 'ready'
  const signals = ready ? [
    content.availability.cbt.href ? 'Quiz' : null,
    content.availability.theory.href ? 'Theory' : null,
  ].filter(Boolean).join(' · ') : ''
  const details = <>
    <div className="min-w-0 flex-1 min-[680px]:flex min-[680px]:items-start min-[680px]:gap-5">
      <span className="block text-[13px] font-bold leading-5 tracking-[0.02em] text-ci-navy min-[680px]:w-20 min-[680px]:shrink-0">
        {course.code}
      </span>
      <span className="block min-w-0">
        <span className="block text-[16px] font-semibold leading-[1.3] text-ci-navy-900">{course.title}</span>
        {ready ? signals && <span className="mt-0.5 block text-[13px] leading-5 text-ci-gray-700">{signals}</span>
          : <span className="mt-0.5 block text-[13px] leading-5 text-ci-gray-700">
            {content.state === 'not-built' ? 'Content not yet available' : 'Content temporarily unavailable'}
          </span>}
      </span>
    </div>
    {ready && <ChevronRight className="h-5 w-5 shrink-0 text-ci-navy" aria-hidden="true" />}
  </>

  return <li className="border-b border-ci-border first:border-t">
    {ready ? <Link href={content.courseHref} prefetch={false}
      className={cx(ROW, 'rounded-ci-btn hover:bg-ci-blue-50', AUTH_FOCUS)}>
      {details}
    </Link> : <div className={ROW}>{details}</div>}
  </li>
}
