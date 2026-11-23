// components/student/DiscoveryOffer.tsx — What an active Discovery Pass offers on one locked course.
// Built from the plan summary and the course's build-time study families only: no course content is read here, and
// following a link spends nothing.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { getCourseByContentKey } from '@/lib/data/courses'
import { DISCOVERY_KINDS, PREVIEW_SEGMENT } from '@/lib/entitlements/discovery-contract'
import { DISCOVERY_PASS_LABEL, formatAccessDate } from '@/lib/entitlements/presentation'
import { studentAction, studentFocusDark } from './ui'
import type { BuildTimeStudy } from '@/lib/courses/build-time-study'
import type { DiscoverySummary } from '@/lib/entitlements/contract'
import type { DiscoveryKind } from '@/lib/entitlements/discovery-contract'
import type { ReactElement } from 'react'

/** An active Discovery Pass: what it includes and when it ends, from the plan summary. */
export type DiscoveryPass = { discovery: DiscoverySummary; endsAt: string | null }

type Offer =
  | { state: 'available' | 'opened' | 'graded'; href: string }
  | { state: 'used-elsewhere'; courseCode: string | null }

function startLabel(kind: DiscoveryKind, pass: DiscoveryPass): string {
  return kind === 'cbt' ? `Take a ${pass.discovery.cbt_questions}-question CBT exam` : 'Choose a notes topic'
}

const OPENED_LABEL: Record<DiscoveryKind, string> = {
  cbt: 'Continue your CBT exam', study_guide: 'Open your notes topic',
}
// What was used on another course, mid-sentence ("Your … was used on ACC 101.").
const USED_LABEL: Record<DiscoveryKind, string> = { cbt: 'CBT exam', study_guide: 'notes topic' }
// The study family each preview needs the course to publish.
const FAMILY: Record<DiscoveryKind, keyof BuildTimeStudy> = { cbt: 'cbtPractice', study_guide: 'notes' }

function offerFor(kind: DiscoveryKind, pass: DiscoveryPass, contentKey: string, courseHref: string): Offer {
  const used = pass.discovery.previews.find(preview => preview.kind === kind)
  const href = `${courseHref}/preview/${PREVIEW_SEGMENT[kind]}`
  if (used === undefined) return { state: 'available', href }
  if (used.content_key !== contentKey) {
    return { state: 'used-elsewhere', courseCode: getCourseByContentKey(used.content_key)?.code ?? null }
  }
  return { state: used.submitted ? 'graded' : 'opened', href }
}

/** What the pass shows on this course: each preview the course publishes, and a preview of this course the student has
 *  already opened, whatever the course publishes now. Empty when the course has nothing to try. */
export function discoveryOffers(pass: DiscoveryPass, contentKey: string, courseHref: string, has: BuildTimeStudy):
  ReadonlyArray<{ kind: DiscoveryKind; offer: Offer }> {
  return DISCOVERY_KINDS.map(kind => ({ kind, offer: offerFor(kind, pass, contentKey, courseHref) }))
    .filter(({ kind, offer }) => has[FAMILY[kind]] || offer.state === 'opened' || offer.state === 'graded')
}

/** Shown in place of the locked notice while the student's pass is active and the course has something to try. */
export function DiscoveryOffer({ pass, contentKey, courseHref, has }: {
  pass: DiscoveryPass; contentKey: string; courseHref: string; has: BuildTimeStudy
}): ReactElement {
  const endsAt = pass.endsAt
  return <section aria-labelledby="discovery-offer-title" className="student-surface student-surface-raised"
    data-discovery-offer="">
    <h2 id="discovery-offer-title" className="student-section-title">Try this course</h2>
    <p className="student-meta mt-1">{DISCOVERY_PASS_LABEL}{endsAt !== null && <> · ends {formatAccessDate(endsAt)}</>}.</p>
    <ul className="mt-4 grid gap-2">
      {discoveryOffers(pass, contentKey, courseHref, has).map(({ kind, offer }) => {
        if (offer.state === 'used-elsewhere') {
          return <li key={kind} className="text-sm text-student-text-muted" data-preview-state={offer.state}>
            Your {USED_LABEL[kind]} was used{offer.courseCode !== null && <> on {offer.courseCode}</>}.
          </li>
        }
        const label = offer.state === 'available' ? startLabel(kind, pass)
          : offer.state === 'graded' ? 'See your CBT exam result' : OPENED_LABEL[kind]
        return <li key={kind} data-preview-state={offer.state}>
          <Link href={offer.href} prefetch={false} className={offer.state === 'available'
            ? studentAction(btnNavy, studentFocusDark, 'w-full justify-start')
            : studentAction(btnGhost, 'bg-student-surface', 'w-full justify-start')}>{label}</Link>
        </li>
      })}
    </ul>
  </section>
}
