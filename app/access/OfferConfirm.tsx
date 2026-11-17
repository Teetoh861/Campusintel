'use client'
// app/access/OfferConfirm.tsx — The one confirmation for an offer a student starts themselves (the free pass, the free
// month): what it gives, its terms, then Start or Not now. Nothing is asked for; the server and the database decide
// everything else.
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { FlowMessage } from './trial-flow'
import type { ReactElement } from 'react'

export function OfferConfirm({ open, busy, title, description, gives, terms, message, confirm, starting, cancel,
  onOpenChange, onConfirm }: {
  open: boolean
  /** A request is in flight: both buttons are disabled and the dialog cannot be dismissed. */
  busy: boolean
  title: string
  /** For screen readers only: what the two lists are. */
  description: string
  gives: ReadonlyArray<string>
  terms: ReadonlyArray<string>
  /** Why the last attempt started nothing, shown above the buttons until the next attempt. */
  message: FlowMessage | null
  confirm: string
  starting: string
  cancel: string
  onOpenChange(open: boolean): void
  onConfirm(): void
}): ReactElement {
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent className="student-plan-dialog">
      <DialogTitle className="text-left text-xl font-bold text-student-text-primary">{title}</DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      <ul className="student-detail-points">{gives.map(item => <li key={item}>{item}</li>)}</ul>
      <ul className="grid gap-1 text-sm text-student-text-secondary">
        {terms.map(term => <li key={term}>{term}</li>)}
      </ul>
      {message && <Feedback tone={message.tone} message={message.text} />}
      <div className="mt-2 grid gap-2 tablet:flex tablet:justify-end">
        <button type="button" disabled={busy} onClick={() => onOpenChange(false)}
          className={studentAction(btnGhost, 'bg-student-surface')}>{cancel}</button>
        <button type="button" disabled={busy} aria-busy={busy} onClick={onConfirm}
          className={studentAction(btnNavy, studentFocusDark)}>{busy ? starting : confirm}</button>
      </div>
    </DialogContent>
  </Dialog>
}
