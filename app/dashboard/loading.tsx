// app/dashboard/loading.tsx — Inert identity and command-centre structure while private data loads.
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactElement } from 'react'

/** Hold real identity space without fabricating a name, counts or course results. */
export default function Loading(): ReactElement {
  return <StudentPage workspaceClassName="dashboard-workspace" band={
    <div aria-hidden="true" className="dashboard-identity">
      <div className="student-workspace dashboard-identity-layout">
        <Skeleton className="h-8 w-3/4 animate-none" />
        <Skeleton className="mt-4 h-28 w-full animate-none" />
      </div>
    </div>}>
    <StudentLoadingState message="Loading your Dashboard.">
      <div className="dashboard-primary-grid">
        <Skeleton className="h-80 w-full rounded-ci-panel animate-none" />
        <Skeleton className="h-80 w-full rounded-ci-panel animate-none" />
      </div>
    </StudentLoadingState>
  </StudentPage>
}
