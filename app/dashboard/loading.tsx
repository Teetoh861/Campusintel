// app/dashboard/loading.tsx — Inert identity and command-centre structure while private data loads.
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactElement } from 'react'

/** Hold real identity space without fabricating a name, counts or course results. */
export default function Loading(): ReactElement {
  return <div className="dashboard-page" role="status" aria-busy="true" data-student-app>
    <span className="sr-only">Loading your Dashboard.</span>
    <div aria-hidden="true">
      <div className="dashboard-identity">
        <div className="student-workspace dashboard-identity-layout">
          <Skeleton className="h-8 w-3/4 motion-reduce:animate-none" />
          <Skeleton className="mt-4 h-28 w-full motion-reduce:animate-none" />
        </div>
      </div>
      <div className="student-workspace dashboard-workspace">
        <div className="dashboard-primary-grid">
          <Skeleton className="h-80 w-full rounded-ci-panel motion-reduce:animate-none" />
          <Skeleton className="h-80 w-full rounded-ci-panel motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  </div>
}
