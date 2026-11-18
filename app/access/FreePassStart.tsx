'use client'
// app/access/FreePassStart.tsx — Starting the free pass: the button opens the confirmation with what the pass gives and
// its terms (they appear only there), then one tap starts it. Nothing is asked for; the server and the database decide
// everything else.
import { useContext, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { FREE_PASS_COPY } from '@/lib/entitlements/presentation'
import { OfferConfirm } from './OfferConfirm'
import { PassOffer } from './TrialActivation'
import { describeResult } from './trial-flow'
import type { FlowMessage } from './trial-flow'
import type { ReactElement } from 'react'

export function FreePassStart({ continuityToken, passHours, profileRevision }: {
  continuityToken: string
  passHours: number
  /** The profile revision this page showed, so the pass sets exactly those courses (D7). */
  profileRevision: number
}): ReactElement | null {
  const router = useRouter()
  const token = useRef(continuityToken).current
  const offer = useContext(PassOffer)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<FlowMessage | null>(null)
  const [closed, setClosed] = useState(false)

  async function activate(): Promise<void> {
    setBusy(true)
    setMessage(null)
    const result = await postEntitlementCommand({ action: 'activate-discovery-pass', profileRevision }, token)
    setBusy(false)
    const { message: next, next: after } = describeResult(result)
    setMessage(next)
    if (after === 'close') { setClosed(true); setOpen(false); offer?.withdraw() }
    if (after === 'refresh') router.refresh()
  }

  if (closed) return message ? <Feedback tone={message.tone} message={message.text} /> : null
  return <>
    <button type="button" onClick={() => { setMessage(null); setOpen(true) }}
      className={studentAction(btnNavy, studentFocusDark)}>{FREE_PASS_COPY.start}</button>
    <OfferConfirm open={open} busy={busy} title={FREE_PASS_COPY.modalTitle}
      description="What the free pass gives, and its terms." gives={FREE_PASS_COPY.gives}
      terms={FREE_PASS_COPY.terms(passHours)} message={message} confirm={FREE_PASS_COPY.confirm}
      starting={FREE_PASS_COPY.starting} cancel={FREE_PASS_COPY.cancel} onOpenChange={setOpen}
      onConfirm={() => void activate()} />
  </>
}
