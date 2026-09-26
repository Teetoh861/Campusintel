import { AuthShell } from '@/components/auth/AuthShell'
import { Skeleton } from '@/components/ui/skeleton'

function PendingField() {
  return <div className="space-y-1">
    <Skeleton className="h-6 w-24 bg-ci-blue-50 motion-reduce:animate-none" />
    <Skeleton className="h-12 w-full rounded-ci-btn bg-ci-blue-50 motion-reduce:animate-none" />
  </div>
}

/** Keep the private page's loading state within the existing form surface. */
export default function Loading() {
  return <AuthShell title="Profile selection">
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">Please wait.</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="space-y-2">
          <PendingField />
          <PendingField />
          <PendingField />
        </div>
        <Skeleton className="h-11 w-full rounded-ci-btn bg-ci-blue-100 motion-reduce:animate-none" />
      </div>
    </div>
  </AuthShell>
}
