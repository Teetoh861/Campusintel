import { Skeleton } from '@/components/ui/skeleton'

/** Stream the existing header and a light course-list shape while private data loads. */
export default function Loading() {
  return <section className="app-container student-page student-reading">
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your semester courses.</span>
      <div aria-hidden="true">
        <div className="flex items-start gap-3 border-b border-student-border pb-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-4/5 max-w-96" />
          </div>
          <Skeleton className="h-11 w-16 rounded-ci-btn" />
        </div>
        <div className="mt-2">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="flex min-h-[76px] items-center border-b border-student-border px-1 py-3">
            <div className="w-full space-y-2 min-[680px]:flex min-[680px]:items-start min-[680px]:gap-5 min-[680px]:space-y-0">
              <Skeleton className="h-4 w-16 min-[680px]:w-20" />
              <div className="w-3/4 max-w-sm space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>)}
        </div>
      </div>
    </div>
  </section>
}
