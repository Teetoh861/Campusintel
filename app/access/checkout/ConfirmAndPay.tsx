'use client'
// app/access/checkout/ConfirmAndPay.tsx — The confirm screen around its pay form: the reason the checkout route sent
// back, then the page's own content, then the form. The reason shows once. It leaves the address as soon as the page
// loads, so a reload or Back starts clean, and it goes away when the student presses Pay again.
import { useEffect, useState } from 'react'
import { Notice } from '@/components/student/Notice'
import { CheckoutForm } from './CheckoutForm'
import type { PlanKey } from '@/lib/entitlements/contract'
import type { ReactElement, ReactNode } from 'react'

// The address parameter the checkout route's reason arrives in.
const STATUS_PARAM = 'status'

export function ConfirmAndPay({ problem, children, plan, priceKobo, expectedRevision, requestId, continuityToken }: {
  // The line for the reason the checkout route sent back, or null when it sent none.
  problem: string | null
  // What the server rendered between the reason and the form: the study context, the courses and the notice.
  children: ReactNode
  plan: PlanKey; priceKobo: number; expectedRevision: number; requestId: string; continuityToken: string
}): ReactElement {
  const [shown, setShown] = useState(problem !== null)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has(STATUS_PARAM)) {
      url.searchParams.delete(STATUS_PARAM)
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    // Back from the payment page can restore this page from memory with the old reason still drawn.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setShown(false) }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])
  return <>
    {shown && problem !== null && <Notice tone="error" title={problem}>{null}</Notice>}
    {children}
    <CheckoutForm plan={plan} priceKobo={priceKobo} expectedRevision={expectedRevision} requestId={requestId}
      continuityToken={continuityToken} onSubmitStart={() => setShown(false)} />
  </>
}
