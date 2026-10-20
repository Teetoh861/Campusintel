// components/student/AccessNotice.tsx — The student's one current plan message (trial, expiry, Early Access).
import Link from 'next/link'
import { btnNavy } from '@/components/chrome/ui'
import { accessNotice } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { Notice } from './Notice'
import { studentAction, studentFocusDark } from './ui'
import type { EntitlementSummary } from '@/lib/entitlements/contract'
import type { ReactElement } from 'react'

/** Renders nothing when there is no summary (read failed) or nothing worth saying. */
export function AccessNotice({ entitlement }: { entitlement: EntitlementSummary | null }): ReactElement | null {
  const notice = entitlement === null ? null : accessNotice(entitlement)
  if (notice === null) return null
  return <div data-access-notice={notice.id}>
    <Notice tone={notice.tone} title={notice.title} action={<Link href={STUDENT_DESTINATIONS.access.href}
      prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>{notice.action}</Link>}>{notice.body}</Notice>
  </div>
}
