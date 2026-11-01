// components/dashboard/ContinueCard.tsx — The one next step once a student has started practising: resume the open
// attempt, or continue the course last practised.
import Link from 'next/link'
import { studentFocusCard } from '@/components/student/ui'
import { formatTimeLeft } from '@/lib/dashboard/home-courses'
import type { ContinuePractice } from '@/lib/dashboard/home-courses'
import type { ReactElement } from 'react'

export function ContinueCard({ next }: { next: ContinuePractice }): ReactElement {
  const label = next.kind === 'resume'
    ? next.minutesLeft === null ? `Resume practice: ${next.code}`
      : `Resume practice: ${next.code}, ${formatTimeLeft(next.minutesLeft)}`
    : `Continue practising ${next.code}`
  return <Link href={next.href} prefetch={false}
    className={`dashboard-continue student-interactive-card student-enter ${studentFocusCard}`} data-continue={next.kind}>
    <span className="dashboard-continue-label">{label}</span>
    <span className="dashboard-continue-title">{next.title}</span>
  </Link>
}
