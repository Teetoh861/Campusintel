// components/student/DiscoveryOffer.tsx — What an active Discovery Pass offers on one locked course.
// Built from the plan summary only: no course content is read here, and following a link spends nothing.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { getCourseByContentKey } from '@/lib/data/courses'
import { DISCOVERY_KINDS, PREVIEW_SEGMENT } from '@/lib/entitlements/discovery-contract'
import { DISCOVERY_PASS_LABEL, DISCOVERY_PREVIEW_LABEL, formatAccessDate } from '@/lib/entitlements/presentation'
import { studentAction, studentFocusDark } from './ui'
import type { DiscoverySummary } from '@/lib/entitlements/contract'
import type { DiscoveryKind } from '@/lib/entitlements/discovery-contract'
import type { ReactElement } from 'react'

/** An active Discovery Pass: what it includes and when it ends, from the plan summary. */
export type DiscoveryPass = { discovery: DiscoverySummary; endsAt: string | null }

type Offer =
  | { state: 'available' | 'opened' | 'graded'; href: string }
  | { state: 'used-elsewhere'; courseCode: string | null }

function startLabel(kind: DiscoveryKind, pass: DiscoveryPass): string {
  return kind === 'cbt' ? `Take a ${pass.discovery.cbt_questions}-question CBT exam` : 'Choose a study guide topic'
}

const OPENED_LABEL: Record<DiscoveryKind, string> = {
  cbt: 'Continue your CBT exam', study_guide: 'Open your study guide topic',
}

function offerFor(kind: DiscoveryKind, pass: DiscoveryPass, contentKey: string, courseHref: string): Offer {
  const used = pass.discovery.previews.find(preview => preview.kind === kind)
  const href = `${courseHref}/preview/${PREVIEW_SEGMENT[kind]}`
  if (used === undefined) return { state: 'available', href }
  if (used.content_key !== contentKey) {
    return { state: 'used-elsewhere', courseCode: getCourseByContentKey(used.content_key)?.code ?? null }
  }
  return { state: used.submitted ? 'graded' : 'opened', href }
}

/** Shown in place of the locked notice while the student's pass is active. */
export function DiscoveryOffer({ pass, contentKey, courseHref }: {
  pass: DiscoveryPass; contentKey: string; courseHref: string
}): ReactElement {
  const endsAt = pass.endsAt
  return <section aria-labelledby="discovery-offer-title" className="student-surface student-surface-raised"
    data-discovery-offer="">
    <h2 id="discovery-offer-title" className="student-section-title">Preview this course</h2>
    <p className="student-meta mt-1">
      {DISCOVERY_PASS_LABEL}{endsAt !== null && <> · ends {formatAccessDate(endsAt)}</>}. You get one CBT exam and one
      study guide topic, each on a course you choose.
    </p>
    <ul className="mt-4 grid gap-2">
      {DISCOVERY_KINDS.map(kind => {
        const offer = offerFor(kind, pass, contentKey, courseHref)
        if (offer.state === 'used-elsewhere') {
          return <li key={kind} className="text-sm text-student-text-muted" data-preview-state={offer.state}>
            Your {DISCOVERY_PREVIEW_LABEL[kind]} was used{offer.courseCode !== null && <> on {offer.courseCode}</>}.
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
