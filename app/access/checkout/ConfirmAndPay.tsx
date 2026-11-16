'use client'
// app/access/checkout/ConfirmAndPay.tsx — The confirm screen around its pay form: the reason the checkout route sent
// back, then the page's own content, then the form. The reason is read here, in the browser, and never rendered by the
// server, so the router's copy of this page has none and Back can't bring it back. It shows once: it leaves the address
// straight away, so a reload starts clean, and it goes when the student presses Pay again.
import { useEffect, useState } from 'react'
import { Notice } from '@/components/student/Notice'
import { CHECKOUT_PROBLEM } from '@/lib/entitlements/presentation'
import { CheckoutForm } from './CheckoutForm'
import type { PlanKey } from '@/lib/entitlements/contract'
import type { ReactElement, ReactNode } from 'react'

// The address parameter the checkout route's reason arrives in.
const STATUS_PARAM = 'status'

/** The line for a reason in the address. already-paid has none: only the server's paid summary decides that. */
function problemFor(status: string | null): string | null {
  if (status === null || status === 'already-paid') return null
  return CHECKOUT_PROBLEM[status] ?? CHECKOUT_PROBLEM.unavailable!
}

export function ConfirmAndPay({ children, plan, priceKobo, expectedRevision, requestId, continuityToken }: {
  // What the server rendered between the reason and the form: the study context, the courses and the notice.
  children: ReactNode
  plan: PlanKey; priceKobo: number; expectedRevision: number; requestId: string; continuityToken: string
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    // Back from the payment page can restore this page from memory with the old reason still drawn.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setProblem(null) }
    window.addEventListener('pageshow', restored)
    const url = new URL(window.location.href)
    let later: number | undefined
    if (url.searchParams.has(STATUS_PARAM)) {
      setProblem(problemFor(url.searchParams.get(STATUS_PARAM)))
      url.searchParams.delete(STATUS_PARAM)
      // On a fresh page load this effect runs before Next's router takes over the browser history (the router's own
      // effect runs after its children's). A replace before then wipes the router's record of this entry, and Back to
      // it would restore the wrong page, so the reason leaves the address on the next task, through the router.
      later = window.setTimeout(() => window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`))
    }
    return () => { window.removeEventListener('pageshow', restored); window.clearTimeout(later) }
  }, [])
  return <>
    {problem !== null && <Notice tone="error" title={problem}>{null}</Notice>}
    {children}
    <CheckoutForm plan={plan} priceKobo={priceKobo} expectedRevision={expectedRevision} requestId={requestId}
      continuityToken={continuityToken} onSubmitStart={() => setProblem(null)} />
  </>
}
