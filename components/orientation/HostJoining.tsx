import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { quizQrPath } from '@/lib/orientation/qr'
import { quizSecondary } from './parts'
/** Venue setup stays available without taking space from the live controls. */
export function HostJoining({ origin,pin }: { origin: string; pin?: string | null }) {
  const qr = origin && pin ? quizQrPath(origin + '/orientation#pin=' + pin) : null
  return <section className="student-surface"><details className="group"><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xl font-bold"><ChevronDown size={20} className="shrink-0 group-open:rotate-180" aria-hidden="true" />Joining links and poster</summary><div className="mt-4 grid gap-4">
    <Link className={quizSecondary} href="/admin/orientation/poster" target="_blank" rel="noopener">Print joining poster without PIN</Link>
    {qr && <><p className="font-semibold">QR with PIN</p><svg role="img" aria-label="Join the orientation quiz with its PIN" viewBox="0 0 45 45" width="225" height="225" className="max-w-full bg-white text-student-text-primary" shapeRendering="crispEdges"><path d={qr} fill="currentColor" /></svg></>}
  </div></details></section>
}
