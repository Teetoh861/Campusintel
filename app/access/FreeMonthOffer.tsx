'use client'
// app/access/FreeMonthOffer.tsx — Claiming the free month (Early Access), wherever it is offered: the Dashboard card, the
// plan card on Plan & Access, the line above Pay on checkout, and the button on a locked course and on Campus Bot. Each
// opens the same confirmation. The request names the action and the profile revision the page showed and nothing else:
// no date and no time. The end date on screen is text the server made from the database's own answer, and this file
// never reads the device clock.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { FREE_MONTH_COPY } from '@/lib/entitlements/presentation'
import { OfferConfirm } from './OfferConfirm'
import { describeFreeMonthResult } from './trial-flow'
import type { FlowMessage } from './trial-flow'
import type { ReactElement } from 'react'

/** What every place that offers the month needs from its page. */
export type FreeMonthClaim = {
  continuityToken: string
  /** The profile revision the page showed, so the month sets exactly those courses (D7). */
  profileRevision: number
  /** The day the month would end, as the server wrote it from the database's answer ("16 December"). */
  endsOn: string
}

/**
 * The button and its confirmation. When the offer is over on this page (the month started, the claim closed, or it is
 * not available on this account), `onOver` lets the caller remove its own offer text; without it, the button gives way
 * to the message, or to nothing once the month has started.
 */
export function FreeMonthStart({ continuityToken, profileRevision, endsOn, quiet = false, wide = false, onOver }:
  FreeMonthClaim & {
    /** A secondary button, beside a primary action that stays (Pay). */
    quiet?: boolean
    /** Fill the card's width, as the plan cards' own buttons do. */
    wide?: boolean
    onOver?(message: FlowMessage | null): void
  }): ReactElement | null {
  const router = useRouter()
  const token = useRef(continuityToken).current
  // A second tap before the button is disabled sends nothing.
  const sending = useRef(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<FlowMessage | null>(null)
  const [over, setOver] = useState(false)

  async function claim(): Promise<void> {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setMessage(null)
    const result = await postEntitlementCommand({ action: 'claim-free-month', profileRevision }, token)
    sending.current = false
    setBusy(false)
    const { message: next, next: step } = describeFreeMonthResult(result)
    setMessage(next)
    if (step === 'started' || step === 'close') {
      setOver(true)
      setOpen(false)
      onOver?.(next)
    }
    // The page is read again: it shows the month and its end date, or the student's current state.
    if (step === 'started' || step === 'refresh') router.refresh()
  }

  if (over) return message && !onOver ? <Feedback tone={message.tone} message={message.text} /> : null
  return <>
    <button type="button" onClick={() => { setMessage(null); setOpen(true) }} data-free-month-start=""
      className={studentAction(quiet ? btnGhost : btnNavy, quiet ? 'bg-student-surface' : studentFocusDark,
        wide ? 'w-full' : undefined)}>{FREE_MONTH_COPY.start}</button>
    <OfferConfirm open={open} busy={busy} title={FREE_MONTH_COPY.title}
      description="What your free month gives, and when it ends." gives={FREE_MONTH_COPY.gives}
      terms={FREE_MONTH_COPY.terms(endsOn)} message={message} confirm={FREE_MONTH_COPY.confirm}
      starting={FREE_MONTH_COPY.starting} cancel={FREE_MONTH_COPY.cancel} onOpenChange={setOpen}
      onConfirm={() => void claim()} />
  </>
}

/** Whether the offer is still on the page, and the message left behind when it is not. */
function useOffer(): { over: boolean; message: FlowMessage | null; end(message: FlowMessage | null): void } {
  const [state, setState] = useState<{ over: boolean; message: FlowMessage | null }>({ over: false, message: null })
  return { ...state, end: message => setState({ over: true, message }) }
}

/** The Dashboard card: title, one line and the button. It goes once the month starts or the offer ends. */
export function FreeMonthCard(claim: FreeMonthClaim): ReactElement | null {
  const offer = useOffer()
  if (offer.over) {
    return offer.message ? <div className="dashboard-offer-over"><Feedback tone={offer.message.tone} message={offer.message.text} /></div>
      : null
  }
  return <section aria-labelledby="free-month-title" className="dashboard-offer student-enter" data-free-month="offer">
    <div className="min-w-0">
      <h2 id="free-month-title" className="dashboard-offer-title">{FREE_MONTH_COPY.title}</h2>
      <p className="dashboard-offer-line">{FREE_MONTH_COPY.line}</p>
    </div>
    <FreeMonthStart {...claim} onOver={offer.end} />
  </section>
}

/** The first plan card on Plan & Access, beside the paid plans: name, price, one line and the button. */
export function FreeMonthPlanCard(claim: FreeMonthClaim): ReactElement | null {
  const offer = useOffer()
  if (offer.over) {
    return offer.message ? <li className="student-surface"><Feedback tone={offer.message.tone} message={offer.message.text} /></li>
      : null
  }
  return <li className="student-surface flex h-full flex-col" data-plan="free-month">
    <h3 className="font-bold text-student-text-primary">{FREE_MONTH_COPY.planName}</h3>
    <p className="mt-1.5 text-3xl font-bold tracking-tight text-student-text-primary">{FREE_MONTH_COPY.price}</p>
    <p className="mt-3 text-sm text-student-text-secondary">{FREE_MONTH_COPY.line}</p>
    <div className="mt-auto pt-5"><FreeMonthStart {...claim} wide onOver={offer.end} /></div>
  </li>
}

/** One line above Pay on checkout. Paying stays possible. */
export function FreeMonthInstead(claim: FreeMonthClaim): ReactElement | null {
  const offer = useOffer()
  if (offer.over) return offer.message ? <Feedback tone={offer.message.tone} message={offer.message.text} /> : null
  return <div className="flex flex-wrap items-center justify-between gap-3" data-free-month="instead">
    <p className="min-w-0 text-sm font-semibold text-student-text-primary">{FREE_MONTH_COPY.instead}</p>
    <FreeMonthStart {...claim} quiet onOver={offer.end} />
  </div>
}
