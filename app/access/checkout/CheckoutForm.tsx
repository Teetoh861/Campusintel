'use client'
// app/access/checkout/CheckoutForm.tsx — Confirm and pay: a plain form POST to /api/payments/checkout (the server answers
// 303 to our payment partner's page, or back here with a reason). It carries the plan, the profile revision this page
// showed, one request id and the page token; never an amount. The button is disabled while submitting, so a double tap
// sends one request, and the server's request id reuses the same order if it ever sends two.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { CONFIRM_COPY } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { PlanKey } from '@/lib/entitlements/contract'
import type { ReactElement } from 'react'

export const CHECKOUT_ACTION = '/api/payments/checkout'

export function CheckoutForm({ plan, priceKobo, expectedRevision, requestId, continuityToken, onSubmitStart }: {
  plan: PlanKey; priceKobo: number; expectedRevision: number; requestId: string; continuityToken: string
  // Called once as a payment attempt starts, so the confirm screen can clear the last attempt's reason.
  onSubmitStart?: () => void
}): ReactElement {
  const [submitting, setSubmitting] = useState(false)
  // Coming back with the browser's Back button restores this page from memory: let the student pay again.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setSubmitting(false) }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])
  return <form method="post" action={CHECKOUT_ACTION} className="student-pay-bar"
    onSubmit={event => { if (submitting) event.preventDefault(); else { setSubmitting(true); onSubmitStart?.() } }}>
    <input type="hidden" name="plan" value={plan} />
    <input type="hidden" name="expected_profile_revision" value={String(expectedRevision)} />
    <input type="hidden" name="request_id" value={requestId} />
    <input type="hidden" name="return_path" value={STUDENT_DESTINATIONS.access.href} />
    <input type="hidden" name="continuity" value={continuityToken} />
    <div className="flex items-center justify-end gap-2">
      <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
        className={studentAction(btnGhost, 'bg-student-surface')}>{CONFIRM_COPY.notNow}</Link>
      <button type="submit" disabled={submitting} aria-busy={submitting}
        className={studentAction(btnNavy, studentFocusDark, 'min-w-0 flex-1 tablet:flex-none tablet:min-w-[280px]')}>
        {submitting ? <><LoaderCircle aria-hidden="true" size={16} className="mr-2 animate-spin motion-reduce:animate-none" />
          {CONFIRM_COPY.opening}</> : CONFIRM_COPY.pay(priceKobo)}
      </button>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{submitting ? CONFIRM_COPY.opening : ''}</p>
  </form>
}
