import { ProfilePageFrame } from '@/components/profile/ProfilePageFrame'
import { Skeleton } from '@/components/ui/skeleton'

function PendingField() {
  return <div className="space-y-1">
    <Skeleton className="h-6 w-24 bg-student-skeleton motion-reduce:animate-none" />
    <Skeleton className="h-12 w-full rounded-ci-btn bg-student-skeleton motion-reduce:animate-none" />
  </div>
}

/** Keep the private page's loading state within the student profile workspace. */
export default function Loading() {
  return <ProfilePageFrame title="Profile selection" narrow>
    <div role="status" aria-live="polite" aria-busy="true"
      className="student-surface student-surface-raised space-y-3">
      <span className="sr-only">Please wait.</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="grid gap-3 tablet:grid-cols-2 tablet:gap-4">
          <div className="tablet:col-span-2"><PendingField /></div>
          <PendingField />
          <PendingField />
        </div>
        <Skeleton className="h-11 w-full rounded-ci-btn bg-student-signal-track motion-reduce:animate-none" />
      </div>
    </div>
  </ProfilePageFrame>
}
