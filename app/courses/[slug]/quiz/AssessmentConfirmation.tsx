// app/courses/[slug]/quiz/AssessmentConfirmation.tsx — Confirm submission or leaving with accessible focus.
'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { btnAccent, btnBase, btnGhost, btnSm, cx } from '@/components/chrome/ui'
import type { ReactElement } from 'react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onRestoreFocus: (event: Event) => void
} & ({ kind: 'leave' } | { kind: 'submit'; answered: number; unanswered: number; flagged: number })

/** Confirm a final decision with contained focus and a safe initial cancel action. */
export function AssessmentConfirmation(props: Props): ReactElement {
  const submitting = props.kind === 'submit'
  return <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
    <AlertDialogContent
      className="z-[70] w-[calc(100%-2rem)] max-w-[440px] rounded-[16px] border-ci-border bg-ci-white p-6 shadow-ci-card motion-reduce:!animate-none"
      onCloseAutoFocus={props.onRestoreFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-left text-[20px] text-ci-navy-900">
          {submitting ? 'Submit assessment?' : 'Leave assessment?'}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-left text-[14px] text-ci-gray-600">
          {submitting ? 'Review your answers before final submission. Unanswered questions receive no credit.'
            : 'Your current local attempt cannot be resumed. You can start a new assessment from the course page.'}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {props.kind === 'submit' ? <dl className="grid grid-cols-3 gap-2 rounded-[10px] bg-ci-paper-2 p-3 text-center">
        <SummaryCount label="Answered" value={props.answered} />
        <SummaryCount label="Unanswered" value={props.unanswered} />
        <SummaryCount label="Flagged" value={props.flagged} />
      </dl> : null}
      <AlertDialogFooter className="mt-3 gap-2 sm:space-x-0">
        <AlertDialogCancel className={cx(btnBase, btnSm, btnGhost, 'mt-0')}>
          {submitting ? 'Return to questions' : 'Stay in assessment'}
        </AlertDialogCancel>
        <AlertDialogAction className={cx(btnBase, btnSm, btnAccent)} onClick={props.onConfirm}>
          {submitting ? 'Submit assessment' : 'Leave assessment'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div><dt className="text-[12px] text-ci-gray-600">{label}</dt>
    <dd className="text-[22px] font-bold text-ci-navy-900">{value}</dd></div>
}
