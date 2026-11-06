'use client'
// app/access/checkout/return/ReturnStatus.tsx — The return page's states. While our order is confirming it polls
// GET /api/payments/orders/[id] (no-store) for two minutes, then shows "still confirming" with Check again. "You're
// subscribed" appears only when the order says paid; nothing is inferred from the redirect, a timer or a cache.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { RETURN_COPY, naira, paymentReference, paymentSupportMessage, planName, subscribedBody }
  from '@/lib/entitlements/presentation'
import { readOrderAnswer } from '@/lib/payments/order-view'
import { RECEIPTS_PATH, checkoutHref } from '@/lib/payments/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import type { OrderRead, OrderView } from '@/lib/payments/order-view'
import type { ReactElement, ReactNode } from 'react'

export const POLL_INTERVAL_MS = 3_000
export const POLL_FOR_MS = 120_000
// After this long since the order was created, a student still waiting is offered a message to support.
const SUPPORT_AFTER_MS = 30 * 60_000
const LOGIN_PATH = '/login'

async function fetchOrder(orderId: string, signal?: AbortSignal): Promise<OrderRead> {
  try {
    const response = await fetch(`/api/payments/orders/${orderId}`, { cache: 'no-store', credentials: 'same-origin', signal })
    return readOrderAnswer(response.status, await response.json().catch(() => null))
  } catch {
    return { kind: 'unavailable' }
  }
}

export function ReturnStatus({ orderId, initial, courseCount }: { orderId: string | null; initial: OrderRead; courseCount: number }):
  ReactElement {
  const [read, setRead] = useState<OrderRead>(initial)
  const [stopped, setStopped] = useState(false)
  const [checking, setChecking] = useState(false)
  const started = useRef(Date.now())
  const confirming = read.kind === 'order' && read.order.state === 'confirming'

  useEffect(() => {
    if (orderId === null || !confirming || stopped) return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      if (Date.now() - started.current >= POLL_FOR_MS) { setStopped(true); return }
      void fetchOrder(orderId, controller.signal).then(next => {
        if (controller.signal.aborted) return
        // A failed check keeps the last answer; the next tick (or Check again) asks again.
        if (next.kind === 'signed-out') window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(window.location.pathname
          + window.location.search)}`)
        else if (next.kind !== 'unavailable') setRead(next)
      })
    }, POLL_INTERVAL_MS)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [orderId, confirming, stopped])

  // Haptic: done, once, when the payment is confirmed (where the device supports it).
  const confirmed = read.kind === 'order' && read.order.state === 'paid'
  useEffect(() => { if (confirmed) navigator.vibrate?.(20) }, [confirmed])

  const checkAgain = useCallback(async () => {
    if (orderId === null) return
    setChecking(true)
    const next = await fetchOrder(orderId)
    setChecking(false)
    if (next.kind === 'order' || next.kind === 'not-found') setRead(next)
  }, [orderId])

  if (read.kind !== 'order') return <Outcome icon="alert" title={RETURN_COPY.notFoundTitle} body={RETURN_COPY.notFoundBody}
    actions={<Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
      className={studentAction(btnNavy, studentFocusDark)}>{RETURN_COPY.accessLink}</Link>} />
  const order = read.order
  const back = <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
    className={studentAction(btnGhost, 'bg-student-surface')}>{RETURN_COPY.backToAccess}</Link>
  const support = (label: string = RETURN_COPY.messageUs) => <a href={buildWhatsAppUrl(paymentSupportMessage(order.order_id))}
    target="_blank" rel="noopener noreferrer" className={studentAction(btnGhost, 'bg-student-surface')}>{label}</a>
  const courses = <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
    className={studentAction(btnNavy, studentFocusDark)}>Go to my courses</Link>

  switch (order.state) {
    case 'confirming': {
      const still = stopped
      const waitedLong = Date.now() - Date.parse(order.created_at) >= SUPPORT_AFTER_MS
      return <Outcome icon="busy" title={still ? RETURN_COPY.stillTitle : RETURN_COPY.confirmingTitle}
        body={still ? RETURN_COPY.stillBody : RETURN_COPY.confirmingBody} status order={order}
        actions={<>
          {still && <button type="button" onClick={() => void checkAgain()} disabled={checking} aria-busy={checking}
            className={studentAction(btnNavy, studentFocusDark)}>{checking ? RETURN_COPY.checking : RETURN_COPY.checkAgain}</button>}
          {back}
        </>}
        after={still && waitedLong ? <p className="text-sm text-student-text-secondary">{RETURN_COPY.stillWaiting}{' '}
          <a href={buildWhatsAppUrl(paymentSupportMessage(order.order_id))} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-student-primary underline underline-offset-2">{RETURN_COPY.messageUs}</a></p> : null} />
    }
    case 'paid': return <div className="mx-auto grid w-full max-w-[560px] gap-6 pt-4" data-return-state="paid">
      <div className="grid gap-3">
        <CircleCheck aria-hidden="true" size={24} className="text-student-success" />
        <h1 className="student-page-band-title">{RETURN_COPY.subscribedTitle}</h1>
        <p className="text-student-text-secondary">{subscribedBody({ tier: order.tier, period: order.period,
          ends_at: order.ends_at, second_starts_at: order.second_starts_at })}</p>
      </div>
      <div className="student-surface">
        <h2 className="font-bold text-student-text-primary">{RETURN_COPY.nowOpen(courseCount)}</h2>
        <ul className="mt-3 grid gap-2.5">{RETURN_COPY.unlocked.map(item => <li key={item}
          className="flex items-start gap-2.5 text-sm text-student-text-primary">
          <Check aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-student-primary" /><span>{item}</span></li>)}</ul>
      </div>
      <p className="text-sm text-student-text-secondary">{RETURN_COPY.setNow}</p>
      <div className="grid gap-2 tablet:flex">
        <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
          className={studentAction(btnNavy, studentFocusDark)}>{RETURN_COPY.startStudying}</Link>
        <Link href={`${RECEIPTS_PATH}/${order.order_id}`} prefetch={false}
          className={studentAction(btnGhost, 'bg-student-surface')}>{RETURN_COPY.viewReceipt}</Link>
      </div>
    </div>
    case 'failed': return <Outcome icon="alert" title={RETURN_COPY.failedTitle} body={RETURN_COPY.failedBody} alert order={order}
      actions={<><Link href={checkoutHref(order.plan)} prefetch={false}
        className={studentAction(btnNavy, studentFocusDark)}>{RETURN_COPY.tryAgain}</Link>{support()}</>} />
    case 'cancelled': return <Outcome icon="alert" title={RETURN_COPY.cancelledTitle} body={RETURN_COPY.cancelledBody} order={order}
      actions={<><Link href={checkoutHref(order.plan)} prefetch={false}
        className={studentAction(btnNavy, studentFocusDark)}>{RETURN_COPY.tryAgain}</Link>{back}</>} />
    case 'paid-duplicate': return <Outcome icon="check" title={RETURN_COPY.alreadyTitle} body={RETURN_COPY.duplicateBody}
      order={order} actions={courses} />
    case 'refund-pending': return <Outcome icon="check" title={RETURN_COPY.refundPendingTitle}
      body={`Your refund of ${naira(order.amount_kobo)} is being processed. Your plan has ended. GST courses stay free.`}
      order={order} actions={back} />
    case 'refunded': return <Outcome icon="check" title={RETURN_COPY.refundedTitle}
      body="Your plan has ended. GST courses stay free." order={order} actions={back} />
  }
}

function Outcome({ icon, title, body, actions, order, status = false, alert = false, after = null }: {
  icon: 'busy' | 'alert' | 'check'; title: string; body: string; actions: ReactNode; order?: OrderView; status?: boolean
  alert?: boolean; after?: ReactNode
}): ReactElement {
  const Icon = icon === 'busy' ? LoaderCircle : icon === 'alert' ? CircleAlert : CircleCheck
  return <div className="mx-auto grid w-full max-w-[560px] gap-6 pt-4" data-return-state={order?.state ?? 'not-found'}>
    <div className="grid gap-3" role={status ? 'status' : alert ? 'alert' : undefined} aria-live={status ? 'polite' : undefined}>
      <Icon aria-hidden="true" size={24} className={icon === 'busy' ? 'animate-spin text-student-primary motion-reduce:animate-none'
        : icon === 'alert' ? 'text-student-error' : 'text-student-success'} />
      <h1 className="student-page-band-title">{title}</h1>
      <p className="text-student-text-secondary">{body}</p>
    </div>
    {order && <dl className="student-surface grid py-1 text-sm">
      <div className="flex justify-between gap-3 border-b border-student-border py-3">
        <dt className="text-student-text-secondary">{RETURN_COPY.plan}</dt>
        <dd className="font-semibold text-student-text-primary">{planName(order.tier, order.period)}</dd>
      </div>
      <div className="flex justify-between gap-3 border-b border-student-border py-3">
        <dt className="text-student-text-secondary">{RETURN_COPY.amount}</dt>
        <dd className="font-semibold text-student-text-primary">{naira(order.amount_kobo)}</dd>
      </div>
      <div className="flex justify-between gap-3 py-3">
        <dt className="text-student-text-secondary">{RETURN_COPY.reference}</dt>
        <dd className="font-semibold text-student-text-primary">{paymentReference(order.order_id)}</dd>
      </div>
    </dl>}
    {after}
    <div className="grid gap-2 tablet:flex">{actions}</div>
  </div>
}
