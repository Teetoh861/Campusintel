import Link from 'next/link'
import { cx, focusRingNavy } from '@/components/chrome/ui'
import type { DashboardCourse } from '@/lib/dashboard/current-student-courses'

const ROW = 'flex min-h-[76px] items-center px-1 py-3'

/** Keep every institutional course visible; only resolved content has a destination. */
export function CourseRow({ course }: { course: DashboardCourse }) {
  const { content } = course
  const ready = content.state === 'ready'
  const details =
    <div className="min-w-0 flex-1 min-[680px]:flex min-[680px]:items-start min-[680px]:gap-5">
      <span className="block text-[13px] font-bold leading-5 tracking-[0.02em] text-ci-navy min-[680px]:w-20 min-[680px]:shrink-0">
        {course.code}
      </span>
      <span className="block min-w-0">
        <span className="block text-[16px] font-semibold leading-[1.3] text-ci-navy-900 transition-colors min-[900px]:group-hover:text-ci-navy">{course.title}</span>
        {!ready && <span className="mt-0.5 block text-[13px] leading-5 text-ci-gray-700">
          {content.state === 'not-built' ? 'Content not yet available' : 'Content temporarily unavailable'}
        </span>}
      </span>
    </div>

  return <li className="border-b border-ci-border first:border-t">
    {ready ? <Link href={content.courseHref} prefetch={false}
      className={cx(ROW, 'group', focusRingNavy)}>
      {details}
    </Link> : <div className={ROW}>{details}</div>}
  </li>
}
