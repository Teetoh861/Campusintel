// app/access/loading.tsx — The access card's shape while the plan loads. Loading is never progress, and nothing that
// could be paid for is offered until the student's access is known.
import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactElement } from 'react'

export default function Loading(): ReactElement {
  return <StudentPage band={<PageBand title="Plan & Access" />}>
    <StudentLoadingState message="Loading your plan.">
      <div className="grid gap-6 desktop:grid-cols-12">
        <div className="student-surface grid gap-2.5 desktop:col-span-4">
          <Skeleton className="h-5 w-[45%] animate-none" />
          <Skeleton className="h-3.5 w-[80%] animate-none" />
        </div>
        <div className="grid gap-4 tablet:grid-cols-2 desktop:col-span-8">
          <Skeleton className="h-48 w-full rounded-lg animate-none" />
          <Skeleton className="h-48 w-full rounded-lg animate-none" />
        </div>
      </div>
    </StudentLoadingState>
  </StudentPage>
}
