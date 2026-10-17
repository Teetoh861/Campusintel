import { PageBand } from '@/components/student/PageBand'
import { StudentLoadingState } from '@/components/student/StudentLoadingState'
import { StudentPage } from '@/components/student/StudentPage'
import { Skeleton } from '@/components/ui/skeleton'

/** Announce loading without exposing unverified course content. */
export default function Loading() {
  return <StudentPage band={<PageBand title="Theory practice" lede="Write, compare and assess your answer." />}>
    <StudentLoadingState message="Loading theory practice.">
      <Skeleton className="h-64 w-full animate-none" />
    </StudentLoadingState>
  </StudentPage>
}
