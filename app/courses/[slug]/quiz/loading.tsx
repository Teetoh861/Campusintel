// app/courses/[slug]/quiz/loading.tsx — Inert Practice loading boundary without unverified course identity.
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'
import { PRACTICE_COPY } from './practice-presentation'
import type { ReactElement } from 'react'

const PLACEHOLDER_ROWS = 3

/** Practice supplies only the placeholder composition; the shared owner announces loading once. */
export default function Loading(): ReactElement {
  return <StudentPage band={<PageBand title={PRACTICE_COPY.title} lede={PRACTICE_COPY.lede}
    context={<Skeleton aria-hidden="true" className="h-4 w-40 max-w-full animate-none" />} />}>
    <StudentLoadingState message={PRACTICE_COPY.loading}>
      <div className="student-stack">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => <Skeleton key={index} className="h-14 w-full animate-none" />)}
        <Skeleton className="h-4 w-3/5 animate-none" />
      </div>
    </StudentLoadingState>
  </StudentPage>
}
