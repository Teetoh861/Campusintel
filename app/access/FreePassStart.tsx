'use client'
// app/access/FreePassStart.tsx — Starting the free pass: Start opens a modal with what the pass gives and its terms (they
// appear only here), then one confirmation. Nothing is asked for; the server and the database decide everything else.
import { useContext, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { FREE_PASS_COPY } from '@/lib/entitlements/presentation'
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
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
      <DialogContent className="student-plan-dialog">
        <DialogTitle className="text-left text-xl font-bold text-student-text-primary">{FREE_PASS_COPY.modalTitle}</DialogTitle>
        <DialogDescription className="sr-only">What the free pass gives, and its terms.</DialogDescription>
        <ul className="student-detail-points">{FREE_PASS_COPY.gives.map(item => <li key={item}>{item}</li>)}</ul>
        <ul className="grid gap-1 text-sm text-student-text-secondary">
          {FREE_PASS_COPY.terms(passHours).map(term => <li key={term}>{term}</li>)}
        </ul>
        {message && <Feedback tone={message.tone} message={message.text} />}
        <div className="mt-2 grid gap-2 tablet:flex tablet:justify-end">
          <button type="button" disabled={busy} onClick={() => setOpen(false)}
            className={studentAction(btnGhost, 'bg-student-surface')}>{FREE_PASS_COPY.cancel}</button>
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => void activate()}
            className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Starting…' : FREE_PASS_COPY.confirm}</button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
