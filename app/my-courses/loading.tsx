// app/my-courses/loading.tsx — Inert skeleton of the preserved semester course workspace.
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactElement } from 'react'

/** Stream an inert semester workspace while the student's private course data loads. */
export default function Loading(): ReactElement {
  return <div className="app-container student-workspace student-page">
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your semester courses.</span>
      <div aria-hidden="true">
        <div className="flex items-center gap-3 rounded-ci-card border border-student-border bg-student-brand-surface px-3 py-3 tablet:px-5 tablet:py-4 desktop:px-6">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-4/5 max-w-96 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-11 w-20 rounded-ci-btn motion-reduce:animate-none" />
        </div>
        <div className="mt-4 grid gap-6 desktop:mt-6 desktop:grid-cols-[minmax(0,1fr)_minmax(240px,280px)] desktop:gap-8">
          <div className="min-w-0">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Skeleton className="h-6 w-32 motion-reduce:animate-none" />
              <Skeleton className="h-11 w-20 rounded-ci-btn motion-reduce:animate-none" />
            </div>
            <div className="mt-3 grid gap-2 tablet:grid-cols-2 tablet:gap-3">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="student-surface flex min-h-[112px] flex-col !p-3 tablet:min-h-[144px] tablet:!p-4 desktop:!p-5">
                <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
                <Skeleton className="mt-2 h-5 w-4/5 motion-reduce:animate-none" />
                <Skeleton className="mt-2 h-4 w-2/3 motion-reduce:animate-none" />
              </div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
}
