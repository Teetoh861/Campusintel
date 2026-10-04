import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cx, focusRingNavy } from '@/components/chrome/ui'
import type { DashboardCourse } from '@/lib/dashboard/current-student-courses'

const CARD = 'student-surface flex h-full min-h-[112px] min-w-0 flex-col !p-3 tablet:min-h-[144px] tablet:!p-4 desktop:!p-5'

function unavailableLabel(state: Exclude<DashboardCourse['content']['state'], 'ready'>): string {
  return state === 'not-built' || state === 'no-learning'
    ? 'Study content not yet available'
    : 'Content temporarily unavailable'
}

/** Show institutional identity and only the learning a student can open today. */
export function CourseRow({ course }: { course: DashboardCourse }) {
  const { content } = course
  const ready = content.state === 'ready'
  const available = ready ? [
    content.availability.overview && 'Overview',
    content.availability.theory && 'Theory',
    content.availability.quiz && 'Practice quiz',
  ].filter((label): label is string => Boolean(label)) : []
  const details = <>
    <span className="block text-[12px] font-bold leading-4 tracking-[0.04em] text-student-signal-strong tablet:text-[13px]">
      {course.code}
    </span>
    <h3 className="mt-1 text-[15px] font-semibold leading-[1.3] text-student-text-primary tablet:text-[17px]">
      {course.title}
    </h3>
    <p className="mt-1 text-[12px] leading-[1.35] text-student-text-secondary tablet:text-[13px]">
      {ready ? <>Available: {available.join(' · ')}</> : unavailableLabel(content.state)}
    </p>
    {ready && <span className="mt-2 inline-flex items-center gap-1 self-start text-[13px] font-semibold leading-5 text-student-primary tablet:mt-auto tablet:pt-2">
      Open course <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
    </span>}
  </>

  return <li className="min-w-0">
    {ready ? <Link href={content.courseHref} prefetch={false}
      className={cx(CARD, 'group border-student-border transition-[border-color,box-shadow,transform] desktop:hover:-translate-y-0.5 desktop:hover:border-student-border-hover desktop:hover:shadow-ci-soft motion-reduce:transform-none motion-reduce:transition-none', focusRingNavy)}>
      {details}
    </Link> : <div className={cx(CARD, 'bg-student-surface-muted')}>
      {details}
    </div>}
  </li>
}
